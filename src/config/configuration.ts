import { registerAs } from '@nestjs/config';

import type { Environment, LogLevel } from './env.validation';
import { validateEnv } from './env.validation';

/**
 * Typed, namespaced config object. Inject the whole object by token:
 *   constructor(@Inject(configuration.KEY) private readonly appConfig: AppConfig) {}
 * or in factories / bootstrap:
 *   inject: [configuration.KEY]
 *   app.get<AppConfig>(configuration.KEY)
 */
export interface AppConfig {
  env: Environment;
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
    corsOrigins:
      env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    logLevel: env.LOG_LEVEL,
    throttleTtl: env.THROTTLE_TTL,
    throttleLimit: env.THROTTLE_LIMIT,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    watchCron: env.WATCH_CRON,
  };
});
