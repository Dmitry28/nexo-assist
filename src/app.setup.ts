import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import compression from 'compression';
import helmet from 'helmet';

import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';

/**
 * Shared by main.ts and the e2e suite so tests exercise the same middleware and
 * routes that production serves. Keep process-level concerns (logger, swagger,
 * shutdown hooks, fatal handlers) in main.ts.
 */
export function configureApp(app: INestApplication): void {
  const appConfig = app.get<AppConfig>(configuration.KEY);

  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: appConfig.corsOrigins });

  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: appConfig.apiVersion });
}
