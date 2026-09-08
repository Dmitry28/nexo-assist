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
import { SENTRY_FLUSH_MS } from './modules/telegram/report';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Use pino as the framework logger.
  const logger = app.get(Logger);
  app.useLogger(logger);

  const appConfig = app.get<AppConfig>(configuration.KEY);

  // Security middleware, CORS, prefix and versioning — shared with e2e tests.
  configureApp(app);

  // ValidationPipe is registered globally via APP_PIPE in AppModule.

  app.enableShutdownHooks();

  // Last-resort safety nets. Node's default behaviour leaves the process in an unknown
  // state — log via pino, then exit so the orchestrator (k8s / docker) can restart us.
  //
  // NOTE: pass the text as `msg` inside the object — nestjs-pino treats a trailing string
  // arg as the log *context*, not the message, so a positional message would be lost here.
  //
  // NOTE: no captureException here. Sentry's own uncaughtException/unhandledRejection
  // integrations are on by default and already report the error — capturing again filed every
  // crash twice, which doubles the event count the whole reporting doctrine reads as "how often
  // does this happen". Those integrations also cover the window before this point (module init),
  // which is why they are the ones to keep. This handler still has to exist: seeing a listener
  // here is what makes Sentry defer the exit to us, and only we know to flush first — a bare
  // process.exit() kills the in-flight send and loses the crash we most want to hear about.
  const reportAndExit = (err: unknown, msg: string): void => {
    logger.fatal({ err, msg });
    void Sentry.flush(SENTRY_FLUSH_MS).finally(() => process.exit(1));
  };
  process.on('uncaughtException', (error) => reportAndExit(error, 'uncaughtException — exiting'));
  process.on('unhandledRejection', (reason) =>
    reportAndExit(reason, 'unhandledRejection — exiting'),
  );

  // Swagger / OpenAPI (disabled in production).
  // TODO [L]: this page does not work. helmet()'s default CSP sends `script-src 'self'` and
  // `script-src-attr 'none'`, and @nestjs/swagger serves its config as an INLINE <script> — so
  // the browser blocks it and /docs renders blank wherever it is enabled (verified against
  // helmet's emitted header and the template in @nestjs/swagger, not live). Decide which way
  // out: scope a CSP exception to this route, or drop Swagger — this app exposes two health
  // endpoints and a metrics endpoint, and `addBearerAuth` documents auth that does not exist.
  // PRODUCT_PLAN.md § Технический бэклог carries the choice.
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
  // A boot failure is caught here, so it is neither an uncaught exception nor an unhandled
  // rejection: Sentry's global handlers never see it. Without this, a pod that cannot start —
  // a bad DATABASE_URL, a failed migration — crash-loops in silence, and the owner learns
  // about it by not hearing anything. Sentry is live by now (src/sentry.ts runs on import).
  Sentry.captureException(error);
  void Sentry.flush(SENTRY_FLUSH_MS).finally(() => process.exit(1));
});
