import type { AppConfig } from '@/config/configuration';
import { Environment, LogLevel } from '@/config/env.validation';

/** A valid AppConfig for unit tests; override only what the test cares about. */
export const makeAppConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  env: Environment.Development,
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
});
