import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';

import type { AppConfig } from './config/configuration';
import configuration from './config/configuration';

/**
 * Shared by main.ts and the e2e suite so tests exercise the same middleware and
 * routes that production serves. Keep process-level concerns (logger, swagger,
 * shutdown hooks, fatal handlers) in main.ts.
 */
export function configureApp(app: NestExpressApplication): void {
  const appConfig = app.get<AppConfig>(configuration.KEY);

  // Trust exactly one proxy hop (k8s ingress / LB) so req.ip is the real client —
  // ThrottlerGuard keys rate limits by it and pino logs it. Never `true`: that
  // would let any client spoof its IP via X-Forwarded-For.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: appConfig.corsOrigins });

  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: appConfig.apiVersion });
}
