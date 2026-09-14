import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';

import { isMachineRequest } from '../machine-request';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

/** HttpException bodies carry `message` as a string (or string[] from ValidationPipe). */
function isMessage(value: unknown): value is string | string[] {
  return (
    typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
  );
}

/**
 * Catches every unhandled exception and returns a consistent JSON error shape.
 * Unknown errors are logged with a stack trace but never leak internals to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  /** The versioned API root, as the probes and the scrape address it. */
  private readonly base: string;

  constructor(@Inject(configuration.KEY) appConfig: AppConfig) {
    this.base = `/${appConfig.apiPrefix}/v${appConfig.apiVersion}`;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = 'message' in res && isMessage(res.message) ? res.message : exception.message;
        error = 'error' in res && typeof res.error === 'string' ? res.error : exception.name;
      }
    }

    if (status >= 500) {
      // Attach the exception to the active trace span (no-op when tracing is off)
      // so error traces are searchable in the APM, not just in logs.
      const span = trace.getActiveSpan();
      if (span) {
        span.recordException(exception instanceof Error ? exception : String(exception));
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // A 5xx is a bug we must hear about — logs alone are not read. Except from the probes:
      // a readiness check answers 503 while the database is unreachable, and the orchestrator
      // asks again every few seconds, so one blip becomes hundreds of Sentry events for a
      // condition the probe itself already reports (the pod leaves the Service, and the
      // watchdog covers the app dying outright). The log line above stays — during an outage
      // it says which check failed, and it never leaves the pod.
      if (!isMachineRequest({ path: request.url.split('?')[0], base: this.base })) {
        Sentry.captureException(exception);
      }
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }
}
