import type { AppConfig } from '@/config/configuration';
import { AppEnv, LogLevel } from '@/config/env.validation';

/** A valid AppConfig for unit tests; override only what the test cares about. */
export const makeAppConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const merged: AppConfig = {
    appEnv: AppEnv.Development,
    isDevelopment: true,
    isStaging: false,
    isProduction: false,
    isTest: false,
    port: 3000,
    apiPrefix: 'api',
    apiVersion: '1',
    corsOrigins: '*',
    logLevel: LogLevel.Info,
    throttleTtl: 60,
    throttleLimit: 100,
    telegramBotToken: undefined,
    watchCron: '0 9 * * *',
    ...overrides,
  };
  // Keep the derived flags consistent with the (possibly overridden) appEnv.
  return {
    ...merged,
    isDevelopment: merged.appEnv === AppEnv.Development,
    isStaging: merged.appEnv === AppEnv.Staging,
    isProduction: merged.appEnv === AppEnv.Production,
    isTest: merged.appEnv === AppEnv.Test,
  };
};
