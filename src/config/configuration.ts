import { registerAs } from '@nestjs/config';

import { Environment, LogLevel, validateEnv } from './env.validation';

/**
 * Typed, namespaced config object. Inject with:
 *   constructor(private readonly config: ConfigService) {}
 *   this.config.get('app.port', { infer: true })
 */
export interface AppConfig {
  env: Environment;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  corsOrigin: string;
  logLevel: LogLevel;
  throttleTtl: number;
  throttleLimit: number;
}

/**
 * Single validation + mapping point. `validateEnv` owns the schema, defaults and
 * coercion (see env.validation.ts); this factory runs eagerly at boot, so invalid
 * config fails fast. Defaults live only in the schema — never duplicate them here.
 */
export default registerAs('app', (): AppConfig => {
  const env = validateEnv(process.env);
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
    corsOrigin: env.CORS_ORIGIN,
    logLevel: env.LOG_LEVEL,
    throttleTtl: env.THROTTLE_TTL,
    throttleLimit: env.THROTTLE_LIMIT,
  };
});
