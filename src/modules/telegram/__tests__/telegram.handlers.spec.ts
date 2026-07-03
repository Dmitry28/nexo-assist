import { Logger } from '@nestjs/common';
import type { Bot, Context } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { TelegramHandlers } from '../telegram.handlers';

type Handler = (ctx: Context) => Promise<void> | void;

/** Captures the handlers grammY would register, so tests can drive them directly. */
class FakeBot {
  readonly commands = new Map<string, Handler>();
  readonly callbacks: Array<{ pattern: RegExp; fn: Handler }> = [];
  onText!: Handler;

  command(name: string, fn: Handler): void {
    this.commands.set(name, fn);
  }

  on(_event: string, fn: Handler): void {
    this.onText = fn;
  }

  callbackQuery(pattern: RegExp, fn: Handler): void {
    this.callbacks.push({ pattern, fn });
  }
}

/** A minimal Context stub; only the fields the handlers read. */
const makeCtx = (over: { text?: string; userId?: number; match?: RegExpMatchArray | string }) => {
  const ctx = {
    message: over.text !== undefined ? { text: over.text } : undefined,
    from: over.userId !== undefined ? { id: over.userId } : undefined,
    match: over.match,
    reply: jest.fn().mockResolvedValue(undefined),
    editMessageText: jest.fn().mockResolvedValue(undefined),
    answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  };
  return ctx as unknown as Context & typeof ctx;
};

describe('TelegramHandlers', () => {
  let bot: FakeBot;
  let subscriptions: SubscriptionsService;
  let kufar: KufarAdapter;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    subscriptions = new SubscriptionsService();
    kufar = new KufarAdapter();
    fetchSpy = jest.spyOn(kufar, 'fetch').mockResolvedValue([listing(1)]);
    const registry = new SourceRegistry([kufar]);
    const handlers = new TelegramHandlers(
      makeAppConfig(),
      subscriptions,
      new WatchService(subscriptions, registry),
      registry,
    );
    bot = new FakeBot();
    handlers.register(bot as unknown as Bot);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Fire the callback handler whose pattern matches `data` (as a real callback would). */
  const pressButton = async (data: string, userId = 1) => {
    const entry = bot.callbacks.find((c) => c.pattern.test(data));
    if (!entry) throw new Error(`no handler for ${data}`);
    const ctx = makeCtx({ userId, match: data.match(entry.pattern) ?? undefined });
    await entry.fn(ctx);
    return ctx;
  };

  /** Paste a link and return the nonce from the reply keyboard plus the ctx. */
  const pasteLink = async (url: string, userId = 1) => {
    const ctx = makeCtx({ text: url, userId });
    await bot.onText(ctx);
    const markup = ctx.reply.mock.calls[0]?.[1]?.reply_markup as
      { inline_keyboard: Array<Array<{ callback_data: string }>> } | undefined;
    const nonce = markup?.inline_keyboard[0][0].callback_data.split(':')[1];
    return { ctx, nonce };
  };

  it('prompts when the text has no url', async () => {
    const ctx = makeCtx({ text: 'hello', userId: 1 });
    await bot.onText(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Send me a kufar.by'));
  });

  it('rejects an unsupported source', async () => {
    const ctx = makeCtx({ text: 'https://example.com/x', userId: 1 });
    await bot.onText(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('subscribes via the button: baseline runs and the confirmation is edited in', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');

    const ctx = await pressButton(`subscribe:${nonce}`);

    const [sub] = subscriptions.listByUser(1);
    expect(sub.url).toBe('https://re.kufar.by/l/minsk');
    expect(sub.baselinedAt).toBeInstanceOf(Date);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('watching 1 current'),
      expect.anything(),
    );
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('subscribes the link of THIS prompt, not the newest pasted one', async () => {
    const { nonce: nonceA } = await pasteLink('https://re.kufar.by/l/aaa');
    await pasteLink('https://re.kufar.by/l/bbb');

    await pressButton(`subscribe:${nonceA}`);

    expect(subscriptions.listByUser(1).map((s) => s.url)).toEqual(['https://re.kufar.by/l/aaa']);
  });

  it("ignores another user's tap on the prompt", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);

    const ctx = await pressButton(`subscribe:${nonce}`, 999);

    expect(subscriptions.listAll()).toEqual([]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('keeps the subscription when the baseline fetch fails — the daily run seeds it', async () => {
    fetchSpy.mockRejectedValue(new Error('outage'));
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');

    const ctx = await pressButton(`subscribe:${nonce}`);

    const [sub] = subscriptions.listByUser(1);
    expect(sub.baselinedAt).toBeUndefined();
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("didn't respond"),
      expect.anything(),
    );
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("ignores another user's cancel tap — the owner's prompt stays subscribable", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);

    const stranger = await pressButton(`cancel:${nonce}`, 999);
    expect(stranger.editMessageText).not.toHaveBeenCalled();
    expect(stranger.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));

    await pressButton(`subscribe:${nonce}`, 1);
    expect(subscriptions.listByUser(1).map((s) => s.url)).toEqual(['https://re.kufar.by/l/minsk']);
  });

  it('cancel consumes the prompt — a later subscribe tap is expired', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');

    await pressButton(`cancel:${nonce}`);
    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.listAll()).toEqual([]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('lists subscriptions with remove buttons and removes only for the owner', async () => {
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });

    const listCtx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(listCtx);
    expect(listCtx.reply).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.anything());

    const stranger = await pressButton(`remove:${sub.id}`, 999);
    expect(stranger.answerCallbackQuery).toHaveBeenCalledWith('Already gone');

    const owner = await pressButton(`remove:${sub.id}`, 1);
    expect(owner.answerCallbackQuery).toHaveBeenCalledWith('Removed');
    expect(subscriptions.listByUser(1)).toEqual([]);
  });

  it('/check baselines a pending subscription instead of flooding it as new', async () => {
    // No markBaselined — e.g. the on-subscribe baseline failed.
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Watching 2 current'),
      expect.anything(),
    );
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('🆕'), expect.anything());
    expect(sub.baselinedAt).toBeInstanceOf(Date);
    expect(subscriptions.getSeen(sub.id).size).toBe(2);
  });

  it('/check replies with the digest and marks only the delivered items seen', async () => {
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    subscriptions.markBaselined(sub.id);
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('🆕 2 new'), expect.anything());
    expect(subscriptions.getSeen(sub.id).size).toBe(2);
  });

  it('/check reports an unregistered source as a failure, not as watched', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    // 'realt' is not registered in this suite's registry — only kufar is.
    subscriptions.add({ telegramUserId: 1, source: 'realt', url: 'u1' });

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Could not check'));
    expect(ctx.reply).not.toHaveBeenCalledWith(
      expect.stringContaining('Watching'),
      expect.anything(),
    );
  });

  it('/check reports a failing subscription without a contradictory "Nothing new."', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    fetchSpy.mockRejectedValue(new Error('outage'));

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Could not check'));
    expect(ctx.reply).not.toHaveBeenCalledWith('Nothing new.');
  });

  it('show-current denies a subscription that is not yours', async () => {
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });

    const ctx = await pressButton(`show:${sub.id}`, 999);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Subscription not found.');
  });
});
