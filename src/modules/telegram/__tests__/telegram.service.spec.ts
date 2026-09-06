import { Logger } from '@nestjs/common';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import type { AppConfig } from '@/config/configuration';
import { AppEnv } from '@/config/env.validation';

import type { TelegramHandlers } from '../telegram.handlers';
import { TelegramService } from '../telegram.service';

// Only the disabled paths are covered — starting grammY would hit the network. Handlers
// are only registered on a live bot, so a stub suffices here.
const make = (overrides: Partial<AppConfig> = {}): TelegramService => {
  const handlers = { register: jest.fn() } as unknown as TelegramHandlers;
  return new TelegramService(makeAppConfig(overrides), handlers);
};

describe('TelegramService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not warn under tests', () => {
    make({ appEnv: AppEnv.Test, telegramBotToken: 'x' }).onModuleInit();

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and disables the bot when no token is set', () => {
    make().onModuleInit();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('shuts down cleanly when the bot never started', async () => {
    await expect(make().onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('notify throws when the bot is disabled — callers must not mark listings seen', async () => {
    await expect(make().notify(1, 'hi')).rejects.toThrow('disabled');
  });
});
