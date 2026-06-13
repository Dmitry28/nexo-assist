import { Logger } from '@nestjs/common';

import type { AppConfig } from '@/config/configuration';
import { Environment, LogLevel } from '@/config/env.validation';

import { TelegramService } from './telegram.service';

// Only the disabled paths are covered — starting grammY would hit the network.
const makeConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  env: Environment.Development,
  port: 3000,
  apiPrefix: 'api',
  apiVersion: '1',
  corsOrigins: '*',
  logLevel: LogLevel.Info,
  throttleTtl: 60,
  throttleLimit: 100,
  telegramBotToken: undefined,
  ...overrides,
});

describe('TelegramService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays silent under tests', () => {
    new TelegramService(
      makeConfig({ env: Environment.Test, telegramBotToken: 'x' }),
    ).onModuleInit();

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and disables the bot when no token is set', () => {
    new TelegramService(makeConfig()).onModuleInit();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('shuts down cleanly when the bot never started', async () => {
    await expect(
      new TelegramService(makeConfig()).onApplicationShutdown(),
    ).resolves.toBeUndefined();
  });
});
