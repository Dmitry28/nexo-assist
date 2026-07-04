// Must be first: starts OpenTelemetry before any instrumented module loads.
import './tracing';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';

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
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaughtException — exiting');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandledRejection — exiting');
    process.exit(1);
  });

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
