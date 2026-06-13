import { Logger } from '@nestjs/common';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import type { AppConfig } from '@/config/configuration';
import { AppEnv } from '@/config/env.validation';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';

// Only the disabled paths are covered — starting grammY would hit the network.
const make = (overrides: Partial<AppConfig> = {}): TelegramService => {
  const config = makeAppConfig(overrides);
  const subscriptions = new SubscriptionsService();
  const registry = new SourceRegistry(new KufarAdapter());
  const watch = new WatchService(subscriptions, registry);
  return new TelegramService(config, new TelegramHandlers(config, subscriptions, watch, registry));
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
});
