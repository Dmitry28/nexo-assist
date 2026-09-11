import { Logger } from '@nestjs/common';
import { Bot, GrammyError } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { sentryCapture, sentryScope } from '@/__tests__/helpers/sentry';
import type { AppConfig } from '@/config/configuration';
import { AppEnv } from '@/config/env.validation';

import { BOT_COMMANDS } from '../telegram.format';
import type { TelegramHandlers } from '../telegram.handlers';
import { MAX_PHOTOS_PER_CARD, TelegramService } from '../telegram.service';

// Only `Bot` is stubbed: it is the one thing that would open a network connection. Everything
// else grammY exports (GrammyError & co) stays real, so error handling is exercised for real.
jest.mock('grammy', () => ({ ...jest.requireActual<object>('grammy'), Bot: jest.fn() }));

const make = (overrides: Partial<AppConfig> = {}): TelegramService => {
  // Handlers are only registered on a live bot, so a stub suffices here.
  const handlers = { register: jest.fn() } as unknown as TelegramHandlers;
  return new TelegramService(makeAppConfig(overrides), handlers);
};

/** The bot the next service will build; `start` decides how the polling loop ends. */
const stubBot = (start: () => Promise<void>) => {
  const bot = {
    api: {
      config: { use: jest.fn() },
      setMyCommands: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue(undefined),
      sendPhoto: jest.fn().mockResolvedValue(undefined),
      sendMediaGroup: jest.fn().mockResolvedValue(undefined),
      sendLocation: jest.fn().mockResolvedValue(undefined),
    },
    catch: jest.fn(),
    start: jest.fn(start),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  (Bot as unknown as jest.Mock).mockReturnValue(bot);
  return bot;
};

/** A live service over that stubbed bot, already initialised. */
const started = (start: () => Promise<void>) => {
  const bot = stubBot(start);
  const service = make({ telegramBotToken: '1:token' });
  service.onModuleInit();
  return { bot, service };
};

/** A polling loop that never settles on its own — what the real one does. */
const pollsForever = () => new Promise<void>(() => undefined);

/** Let the queued `.catch`/`.finally` chains run — `process.exit` sits behind two of them. */
const settle = (): Promise<unknown> => new Promise((resolve) => setImmediate(resolve));

describe('TelegramService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
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

  it('exits and reports when the polling loop dies on its own', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.spyOn(Logger.prototype, 'fatal').mockImplementation();
    const err = new Error('polling died');

    started(() => Promise.reject(err));
    await settle();

    // A deliberate exit trips none of main.ts's fatal handlers, so the report has to happen here.
    expect(sentryCapture()).toHaveBeenCalledWith(err);
    expect(exit).toHaveBeenCalledWith(1);
  });

  // grammY's start() rejects when stop() aborts its setup, so an orderly shutdown lands in the
  // same catch as a dead loop. Exiting there would kill the rest of the shutdown.
  it('does not exit when our own shutdown aborts the polling loop', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let abort!: (err: Error) => void;
    const { bot, service } = started(
      () =>
        new Promise<void>((_, reject) => {
          abort = reject;
        }),
    );

    await service.onApplicationShutdown();
    abort(new Error('aborted by stop()'));
    await settle();

    expect(bot.stop).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  it('notify throws after shutdown — a run in flight must not mark unsent listings seen', async () => {
    // The real polling loop never settles on its own either.
    const { bot, service } = started(pollsForever);

    await service.notify(7, 'hi');
    expect(bot.api.sendMessage).toHaveBeenCalledWith(7, 'hi', {
      link_preview_options: { is_disabled: true },
    });

    await service.onApplicationShutdown();

    await expect(service.notify(7, 'hi')).rejects.toThrow('shutting down');
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  // Nest abandons the rest of the shutdown if this hook rejects, and grammY's stop() awaits one
  // more getUpdates — an unreachable Telegram API would take the TypeORM close down with it.
  it('finishes the shutdown even when stopping the bot fails', async () => {
    const { bot, service } = started(pollsForever);
    bot.stop.mockRejectedValue(new Error('telegram unreachable'));

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ err: expect.anything() }, 'Bot stop failed');
  });

  it('reports what actually threw in a handler, not grammY middleware wrapper', () => {
    const { bot } = started(pollsForever);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const cause = new Error('the real failure');
    const onError = bot.catch.mock.calls[0][0] as (err: unknown) => void;

    onError({ error: cause, ctx: { from: { id: 42 } } });

    expect(sentryCapture()).toHaveBeenCalledWith(cause);
    expect(sentryScope().setUser).toHaveBeenCalledWith({ id: '42' });
  });

  // Without the menu, /list exists but is unreachable once the buttons scroll away.
  it('publishes the command menu', () => {
    const { bot } = started(pollsForever);

    expect(bot.api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS);
  });

  it('starts anyway when publishing the command menu fails', async () => {
    const bot = stubBot(pollsForever);
    bot.api.setMyCommands.mockRejectedValue(new Error('telegram down'));

    make({ telegramBotToken: '1:token' }).onModuleInit();
    await settle();

    // An unreachable Telegram API must not stop the bot; the menu is retried on the next boot.
    expect(bot.start).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { err: expect.anything() },
      expect.stringContaining('command menu'),
    );
  });
});

describe('notifyCard', () => {
  const photos = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `https://cdn/${i}.jpg`);

  it('sends a lone photo with the card as its caption', async () => {
    const { bot, service } = started(pollsForever);

    await service.notifyCard(7, { caption: '<b>card</b>', images: photos(1) });

    expect(bot.api.sendPhoto).toHaveBeenCalledWith(7, 'https://cdn/0.jpg', {
      caption: '<b>card</b>',
      parse_mode: 'HTML',
    });
  });

  it('puts the caption on the first item of a group — Telegram ignores the others', async () => {
    const { bot, service } = started(pollsForever);

    await service.notifyCard(7, { caption: 'card', images: photos(3) });

    const [, media] = bot.api.sendMediaGroup.mock.calls[0] as [number, InputMediaPhoto[]];
    expect(media).toHaveLength(3);
    expect(media[0]).toMatchObject({ media: 'https://cdn/0.jpg', caption: 'card' });
    expect(media.slice(1).every((item) => item.caption === undefined)).toBe(true);
  });

  it('caps a group at the limit Telegram accepts', async () => {
    const { bot, service } = started(pollsForever);

    await service.notifyCard(7, { caption: 'card', images: photos(MAX_PHOTOS_PER_CARD + 5) });

    const [, media] = bot.api.sendMediaGroup.mock.calls[0] as [number, InputMediaPhoto[]];
    expect(media).toHaveLength(MAX_PHOTOS_PER_CARD);
  });

  it('sends a card without photos as a plain HTML message', async () => {
    const { bot, service } = started(pollsForever);

    await service.notifyCard(7, { caption: 'card', images: [] });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      7,
      'card',
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
    expect(bot.api.sendPhoto).not.toHaveBeenCalled();
  });

  // The listing matters more than its pictures, and only what arrives is marked seen.
  it('falls back to the text card when the media is refused', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { bot, service } = started(pollsForever);
    bot.api.sendPhoto.mockRejectedValue(new Error('WEBPAGE_MEDIA_EMPTY'));

    await service.notifyCard(7, { caption: 'card', images: photos(1) });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(7, 'card', expect.anything());
  });

  it('gives up when the chat itself is blocked — the text would be refused too', async () => {
    const { bot, service } = started(pollsForever);
    const blocked = new GrammyError(
      'Forbidden: bot was blocked by the user',
      { ok: false, error_code: 403, description: 'blocked' },
      'sendPhoto',
      {},
    );
    bot.api.sendPhoto.mockRejectedValue(blocked);

    await expect(service.notifyCard(7, { caption: 'card', images: photos(1) })).rejects.toBe(
      blocked,
    );
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it('drops the pin after the card, and a failed pin is not a failed delivery', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { bot, service } = started(pollsForever);
    bot.api.sendLocation.mockRejectedValue(new Error('nope'));

    await expect(
      service.notifyCard(7, {
        caption: 'card',
        images: photos(1),
        coordinates: { lat: 53.68, lon: 23.85 },
      }),
    ).resolves.toBeUndefined();
    expect(bot.api.sendLocation).toHaveBeenCalledWith(7, 53.68, 23.85);
  });

  it('throws when the bot is disabled — callers must not mark listings seen', async () => {
    await expect(make().notifyCard(1, { caption: 'card', images: [] })).rejects.toThrow('disabled');
  });
});
