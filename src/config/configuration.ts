import { registerAs } from '@nestjs/config';

import type { LogLevel } from './env.validation';
import { AppEnv, Environment, validateEnv } from './env.validation';

/**
 * Typed, namespaced config object. Inject the whole object by token:
 *   constructor(@Inject(configuration.KEY) private readonly appConfig: AppConfig) {}
 * or in factories / bootstrap:
 *   inject: [configuration.KEY]
 *   app.get<AppConfig>(configuration.KEY)
 */
export interface AppConfig {
  /** Deployment stage — drives app behavior. */
  appEnv: AppEnv;
  /** Derived from `appEnv` — use these instead of comparing `appEnv` inline. */
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  /** Ready for `enableCors`: '*' must stay a literal string; an array is matched exactly. */
  corsOrigins: '*' | string[];
  logLevel: LogLevel;
  throttleTtl: number;
  throttleLimit: number;
  /** Telegram bot token; `undefined` keeps the bot disabled. */
  telegramBotToken: string | undefined;
  /** Cron expression for the daily subscription check. */
  watchCron: string;
  /** Base pause between subscription polls, in ms. */
  watchMinDelayMs: number;
  /** Extra random pause (0..this) added to the base, in ms. */
  watchJitterMs: number;
  /** Postgres connection URL (local docker by default; Neon in staging/prod). */
  databaseUrl: string;
}

/** Derived `appEnv` flags — the single mapping, shared with test fixtures. */
export function stageFlags(
  appEnv: AppEnv,
): Pick<AppConfig, 'isDevelopment' | 'isStaging' | 'isProduction' | 'isTest'> {
  return {
    isDevelopment: appEnv === AppEnv.Development,
    isStaging: appEnv === AppEnv.Staging,
    isProduction: appEnv === AppEnv.Production,
    isTest: appEnv === AppEnv.Test,
  };
}

/**
 * Single validation + mapping point. `validateEnv` owns the schema, defaults and
 * coercion (see env.validation.ts); this factory runs eagerly at boot, so invalid
 * config fails fast. Defaults live only in the schema — never duplicate them here.
 */
export default registerAs('app', (): AppConfig => {
  const env = validateEnv(process.env);
  // NOTE: APP_ENV is the deployment stage; default to test under jest, else development.
  const appEnv =
    env.APP_ENV ?? (env.NODE_ENV === Environment.Test ? AppEnv.Test : AppEnv.Development);
  return {
    appEnv,
    ...stageFlags(appEnv),
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
    corsOrigins:
      env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    logLevel: env.LOG_LEVEL,
    throttleTtl: env.THROTTLE_TTL,
    throttleLimit: env.THROTTLE_LIMIT,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    watchCron: env.WATCH_CRON,
    watchMinDelayMs: env.WATCH_MIN_DELAY_MS,
    watchJitterMs: env.WATCH_JITTER_MS,
    databaseUrl: env.DATABASE_URL,
  };
});
