// Must be first: starts OpenTelemetry before any instrumented module loads.
import './tracing';

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { Environment } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use pino as the framework logger.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');

  // Security & performance middleware.
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    // '*' must stay a literal string; an array of origins is matched exactly.
    origin:
      appConfig.corsOrigin === '*' ? '*' : appConfig.corsOrigin.split(',').map((o) => o.trim()),
  });

  // Routing: /api/v1/...
  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: appConfig.apiVersion });

  // ValidationPipe is registered globally via APP_PIPE in AppModule.

  app.enableShutdownHooks();

  // Swagger / OpenAPI (disabled in production).
  if (appConfig.env !== Environment.Production) {
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

  app.get(Logger).log(`Application listening on port ${appConfig.port}`, 'Bootstrap');
}

void bootstrap();
