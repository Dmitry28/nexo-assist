import type { AppConfig } from '@/config/configuration';
import { stageFlags } from '@/config/configuration';
import { AppEnv, DEFAULT_DATABASE_URL, LogLevel } from '@/config/env.validation';

/** A valid AppConfig for unit tests; override only what the test cares about. */
export const makeAppConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const merged: AppConfig = {
    appEnv: AppEnv.Development,
    ...stageFlags(AppEnv.Development),
    port: 3000,
    apiPrefix: 'api',
    apiVersion: '1',
    corsOrigins: '*',
    logLevel: LogLevel.Info,
    throttleTtl: 60,
    throttleLimit: 100,
    telegramBotToken: undefined,
    watchCron: '0 9 * * *',
    databaseUrl: DEFAULT_DATABASE_URL,
    ...overrides,
  };
  // Keep the derived flags consistent with the (possibly overridden) appEnv.
  return { ...merged, ...stageFlags(merged.appEnv) };
};
