import { Logger } from '@nestjs/common';
import type { Bot, Context } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';

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

const sub = (over: Partial<Subscription> = {}): Subscription =>
  ({ id: 'sub-1', user: { telegramId: 1 }, source: 'kufar', url: 'u1', ...over }) as Subscription;

// Collaborators are mocked — these tests cover the bot conversation (pending nonces,
// ownership, replies), not persistence (the DB layer is covered by the integration e2e).
describe('TelegramHandlers', () => {
  let bot: FakeBot;
  let subscriptions: {
    add: jest.Mock;
    listByUser: jest.Mock;
    remove: jest.Mock;
  };
  let watch: { baseline: jest.Mock; poll: jest.Mock; current: jest.Mock; markSeen: jest.Mock };

  beforeEach(() => {
    subscriptions = {
      add: jest
        .fn()
        .mockImplementation((input: { url: string }) => Promise.resolve(sub({ url: input.url }))),
      listByUser: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(true),
    };
    watch = {
      baseline: jest.fn().mockResolvedValue(1),
      poll: jest.fn(),
      current: jest.fn().mockResolvedValue([]),
      markSeen: jest.fn().mockResolvedValue(undefined),
    };
    const handlers = new TelegramHandlers(
      makeAppConfig(),
      subscriptions as unknown as SubscriptionsService,
      watch as unknown as WatchService,
      new SourceRegistry([new KufarAdapter()]),
    );
    bot = new FakeBot();
    handlers.register(bot as unknown as Bot);
  });

  afterEach(() => jest.restoreAllMocks());

  const pressButton = async (data: string, userId = 1) => {
    const entry = bot.callbacks.find((c) => c.pattern.test(data));
    if (!entry) throw new Error(`no handler for ${data}`);
    const ctx = makeCtx({ userId, match: data.match(entry.pattern) ?? undefined });
    await entry.fn(ctx);
    return ctx;
  };

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

  it('subscribes via the button: adds + baselines, edits the confirmation in', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ telegramId: 1 }),
        url: 'https://re.kufar.by/l/minsk',
      }),
    );
    expect(watch.baseline).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('watching 1 current'),
      expect.anything(),
    );
  });

  it('subscribes the link of THIS prompt, not the newest pasted one', async () => {
    const { nonce: nonceA } = await pasteLink('https://re.kufar.by/l/aaa');
    await pasteLink('https://re.kufar.by/l/bbb');

    await pressButton(`subscribe:${nonceA}`);

    expect(subscriptions.add).toHaveBeenCalledTimes(1);
    expect(subscriptions.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://re.kufar.by/l/aaa' }),
    );
  });

  it("ignores another user's subscribe tap", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);
    const ctx = await pressButton(`subscribe:${nonce}`, 999);

    expect(subscriptions.add).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('keeps the subscription when the baseline fetch fails', async () => {
    watch.baseline.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');

    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("didn't respond"),
      expect.anything(),
    );
  });

  it("ignores another user's cancel tap — the owner's prompt stays subscribable", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);

    const stranger = await pressButton(`cancel:${nonce}`, 999);
    expect(stranger.editMessageText).not.toHaveBeenCalled();
    expect(stranger.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));

    await pressButton(`subscribe:${nonce}`, 1);
    expect(subscriptions.add).toHaveBeenCalledTimes(1);
  });

  it('cancel consumes the prompt — a later subscribe tap is expired', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    await pressButton(`cancel:${nonce}`);
    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });

  it('lists subscriptions with remove buttons and removes for the owner', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1', url: 'u1' })]);
    const listCtx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(listCtx);
    expect(listCtx.reply).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.anything());

    subscriptions.remove.mockResolvedValue(true);
    const ctx = await pressButton('remove:s1', 1);
    expect(subscriptions.remove).toHaveBeenCalledWith('s1', 1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Removed');
  });

  it('remove answers "Already gone" when nothing was deleted', async () => {
    subscriptions.remove.mockResolvedValue(false);
    const ctx = await pressButton('remove:s1', 999);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Already gone');
  });

  it('/check baselines a pending subscription instead of flooding it as new', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockResolvedValue({ kind: 'baselined', count: 2 });

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Watching 2 current'),
      expect.anything(),
    );
    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('/check replies with the digest and marks the delivered items seen', async () => {
    const s = sub({ url: 'u1' });
    subscriptions.listByUser.mockResolvedValue([s]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1), listing(2)] });

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('🆕 2 new'), expect.anything());
    expect(watch.markSeen).toHaveBeenCalledWith(s, [listing(1), listing(2)]);
  });

  it('/check reports a failing subscription without a contradictory "Nothing new."', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Could not check'));
    expect(ctx.reply).not.toHaveBeenCalledWith('Nothing new.');
  });

  it('show-current denies a subscription that is not yours', async () => {
    subscriptions.listByUser.mockResolvedValue([]); // user 999 owns nothing
    const ctx = await pressButton('show:sub-1', 999);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Subscription not found.');
    expect(watch.current).not.toHaveBeenCalled();
  });
});
