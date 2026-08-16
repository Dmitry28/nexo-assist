// Must be first: starts error reporting, then OpenTelemetry, before any instrumented module loads.
import './sentry';
import './tracing';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';

// How long to wait for a crash report to reach Sentry before exiting anyway.
const SENTRY_FLUSH_MS = 2000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Use pino as the framework logger.
  app.useLogger(app.get(Logger));

  const appConfig = app.get<AppConfig>(configuration.KEY);

  // Security middleware, CORS, prefix and versioning — shared with e2e tests.
  configureApp(app);

  // ValidationPipe is registered globally via APP_PIPE in AppModule.

  app.enableShutdownHooks();

  // Last-resort safety nets. Node's default behaviour leaves the process in an unknown
  // state — log via pino, then exit so the orchestrator (k8s / docker) can restart us.
  const logger = app.get(Logger);
  // NOTE: pass the text as `msg` inside the object — nestjs-pino treats a trailing string
  // arg as the log *context*, not the message, so a positional message would be lost here.
  // NOTE: report BEFORE exiting and wait for the send — process.exit() would otherwise kill the
  // in-flight request and the crash we most want to hear about would never arrive.
  const reportAndExit = (err: unknown, msg: string): void => {
    logger.fatal({ err, msg });
    Sentry.captureException(err);
    void Sentry.flush(SENTRY_FLUSH_MS).finally(() => process.exit(1));
  };
  process.on('uncaughtException', (error) => reportAndExit(error, 'uncaughtException — exiting'));
  process.on('unhandledRejection', (reason) =>
    reportAndExit(reason, 'unhandledRejection — exiting'),
  );

  // Swagger / OpenAPI (disabled in production).
  if (!appConfig.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('nexo-assist API')
      .setDescription('API documentation')
      .setVersion(appConfig.apiVersion)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${appConfig.apiPrefix}/docs`, app, document);
  }

  await app.listen(appConfig.port);

  // Echo the effective (validated) config — mask secrets so they never hit logs
  // (the bot token and the DB URL, which carries credentials).
  const { telegramBotToken, databaseUrl, ...safeConfig } = appConfig;
  logger.log(
    {
      config: {
        ...safeConfig,
        telegramBotToken: telegramBotToken ? '[set]' : undefined,
        databaseUrl: databaseUrl ? '[set]' : undefined,
      },
    },
    'Bootstrap',
  );
  logger.log(`Application listening on port ${appConfig.port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Bootstrap failed before pino was wired — console is the only logger left.
  console.error(error);
  process.exit(1);
});
