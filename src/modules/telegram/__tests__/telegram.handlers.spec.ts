import { Logger } from '@nestjs/common';
import type { Bot, Context } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { sentryCapture, sentryScope } from '@/__tests__/helpers/sentry';
import { AppEnv } from '@/config/env.validation';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  SubscriptionLimitError,
} from '@/modules/subscriptions/subscriptions.service';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';

import { HELP_MESSAGE } from '../telegram.format';
import { TelegramHandlers } from '../telegram.handlers';
import { WatchStatus } from '../watch.status';

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
    resume: jest.Mock;
    countUsers: jest.Mock;
    countActive: jest.Mock;
    countPaused: jest.Mock;
  };
  let watch: { baseline: jest.Mock; poll: jest.Mock; current: jest.Mock; markSeen: jest.Mock };
  // Real WatchStatus — dependency-free, and /check's polling slot is part of what is tested.
  let status: WatchStatus;

  const buildHandlers = (config = makeAppConfig()) => {
    const handlers = new TelegramHandlers(
      config,
      subscriptions as unknown as SubscriptionsService,
      watch as unknown as WatchService,
      new SourceRegistry([new KufarAdapter()]),
      status,
    );
    const fakeBot = new FakeBot();
    handlers.register(fakeBot as unknown as Bot);
    return fakeBot;
  };

  beforeEach(() => {
    status = new WatchStatus();
    subscriptions = {
      add: jest
        .fn()
        .mockImplementation((input: { url: string }) => Promise.resolve(sub({ url: input.url }))),
      listByUser: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(true),
      resume: jest.fn().mockResolvedValue(true),
      countUsers: jest.fn().mockResolvedValue(0),
      countActive: jest.fn().mockResolvedValue(0),
      countPaused: jest.fn().mockResolvedValue(0),
    };
    watch = {
      baseline: jest.fn().mockResolvedValue(1),
      poll: jest.fn(),
      current: jest.fn().mockResolvedValue([]),
      markSeen: jest.fn().mockResolvedValue(undefined),
    };
    bot = buildHandlers();
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
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Пришлите ссылку на поиск'));
  });

  it('rejects an unsupported source', async () => {
    const ctx = makeCtx({ text: 'https://example.com/x', userId: 1 });
    await bot.onText(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('пока не поддерживается'));
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
      expect.stringContaining('Объявлений сейчас: 1'),
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

  it('tells the user when already watching this url (duplicate)', async () => {
    subscriptions.add.mockRejectedValue(new DuplicateSubscriptionError());
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const ctx = await pressButton(`subscribe:${nonce}`);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('уже следите'),
      expect.anything(),
    );
    expect(watch.baseline).not.toHaveBeenCalled();
  });

  it('tells the user when the subscription limit is reached', async () => {
    subscriptions.add.mockRejectedValue(new SubscriptionLimitError());
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const ctx = await pressButton(`subscribe:${nonce}`);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Достигнут предел'));
    expect(watch.baseline).not.toHaveBeenCalled();
  });

  it("ignores another user's subscribe tap", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);
    const ctx = await pressButton(`subscribe:${nonce}`, 999);

    expect(subscriptions.add).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('устарела'));
  });

  it('keeps the subscription when the baseline fetch fails', async () => {
    watch.baseline.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');

    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Сайт сейчас не отвечает'),
      expect.anything(),
    );
  });

  it("ignores another user's cancel tap — the owner's prompt stays subscribable", async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 1);

    const stranger = await pressButton(`cancel:${nonce}`, 999);
    expect(stranger.editMessageText).not.toHaveBeenCalled();
    expect(stranger.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('устарела'));

    await pressButton(`subscribe:${nonce}`, 1);
    expect(subscriptions.add).toHaveBeenCalledTimes(1);
  });

  it('cancel consumes the prompt — a later subscribe tap is expired', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    await pressButton(`cancel:${nonce}`);
    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('устарела'));
  });

  it('/help replies with the help text', async () => {
    const ctx = makeCtx({ userId: 1 });

    await buildHandlers().commands.get('help')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(HELP_MESSAGE, expect.anything());
  });

  it('lists subscriptions with remove buttons and removes for the owner', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1', url: 'u1' })]);
    const listCtx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(listCtx);
    expect(listCtx.reply).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.anything());

    subscriptions.remove.mockResolvedValue(true);
    const ctx = await pressButton('remove:s1', 1);
    expect(subscriptions.remove).toHaveBeenCalledWith('s1', 1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Удалено');
  });

  it('marks a paused subscription in /list and offers to resume it', async () => {
    subscriptions.listByUser.mockResolvedValue([
      sub({ id: 'active' }),
      sub({ id: 'paused', pausedAt: new Date() }),
    ]);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(ctx);

    const [text, options] = ctx.reply.mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
    ];
    expect(text).toContain('#2 — kufar ⏸ на паузе');
    expect(text).not.toContain('#1 — kufar ⏸');
    const buttons = options.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(buttons).toContain('resume:paused');
    expect(buttons).not.toContain('resume:active');
  });

  it('caps /list by buttons, not rows — a paused row carries two', async () => {
    // 50 paused rows would be 100 buttons; Telegram rejects the reply and /list is lost.
    subscriptions.listByUser.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => sub({ id: `s${i}`, pausedAt: new Date() })),
    );

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('list')!(ctx);

    const [, options] = ctx.reply.mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard.flat().length).toBeLessThanOrEqual(90);
  });

  it('resume un-pauses the subscription', async () => {
    subscriptions.resume.mockResolvedValue(true);

    const ctx = await pressButton('resume:sub-1', 1);

    expect(subscriptions.resume).toHaveBeenCalledWith('sub-1', 1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Возобновлено');
  });

  it('resume refuses when the user is at the active-subscription limit', async () => {
    subscriptions.resume.mockRejectedValue(new SubscriptionLimitError());

    const ctx = await pressButton('resume:sub-1', 1);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.stringContaining('Предел'));
  });

  it('remove answers "Уже удалено" when nothing was deleted', async () => {
    subscriptions.remove.mockResolvedValue(false);
    const ctx = await pressButton('remove:s1', 999);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Уже удалено');
  });

  it('/check baselines a pending subscription instead of flooding it as new', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockResolvedValue({ kind: 'baselined', count: 2 });

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('объявлений сейчас: 2'),
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

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('🆕 Новых объявлений: 2'),
      expect.anything(),
    );
    expect(watch.markSeen).toHaveBeenCalledWith(s, [listing(1), listing(2)]);
  });

  it('/check keeps the delivered digest when markSeen fails — no contradictory error', async () => {
    const s = sub({ url: 'u1' });
    subscriptions.listByUser.mockResolvedValue([s]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    watch.markSeen.mockRejectedValue(new Error('db down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('🆕 Новых объявлений: 1'),
      expect.anything(),
    );
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('Не получилось проверить'));
    expect(ctx.reply).not.toHaveBeenCalledWith('Ничего нового.');
    // Silent to the user, but it must not be silent to us: the items stay unmarked and re-send.
    expect(sentryScope().setTag).toHaveBeenCalledWith('op', 'mark-seen');
    expect(sentryScope().setTag).toHaveBeenCalledWith('action', 'check');
    expect(sentryCapture()).toHaveBeenCalled();
  });

  it('/check reports a failing subscription without a contradictory "Ничего нового."', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Не получилось проверить'));
    expect(ctx.reply).not.toHaveBeenCalledWith('Ничего нового.');
  });

  it('/check answers the owner in production — the only live check without waiting for the cron', async () => {
    const prodBot = buildHandlers(
      makeAppConfig({ appEnv: AppEnv.Production, adminTelegramId: 99 }),
    );
    subscriptions.listByUser.mockResolvedValue([]);

    const ctx = makeCtx({ userId: 99 });
    await prodBot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Пока нет ни одной подписки'));
  });

  it('/check stays silent for a non-owner in production', async () => {
    const prodBot = buildHandlers(
      makeAppConfig({ appEnv: AppEnv.Production, adminTelegramId: 99 }),
    );

    const ctx = makeCtx({ userId: 1 });
    await prodBot.commands.get('check')!(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(subscriptions.listByUser).not.toHaveBeenCalled();
  });

  it('/check announces the batch and polls every subscription in it', async () => {
    // Zero delays: the paced loop would otherwise really sleep between subscriptions.
    const fast = buildHandlers(makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }));
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1' }), sub({ id: 's2' })]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    const ctx = makeCtx({ userId: 1 });
    await fast.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Проверяю подписок: 2'));
    expect(watch.poll).toHaveBeenCalledTimes(2);
  });

  it('/check skips paused subscriptions — the daily run does not poll them either', async () => {
    const fast = buildHandlers(makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }));
    subscriptions.listByUser.mockResolvedValue([
      sub({ id: 'paused', pausedAt: new Date() }),
      sub({ id: 'active' }),
    ]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    await fast.commands.get('check')!(makeCtx({ userId: 1 }));

    expect(watch.poll).toHaveBeenCalledTimes(1);
    expect(watch.poll).toHaveBeenCalledWith(expect.objectContaining({ id: 'active' }));
  });

  it('/check says so when every subscription is paused', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1', pausedAt: new Date() })]);

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('на паузе'));
    expect(watch.poll).not.toHaveBeenCalled();
  });

  it('/check refuses to start while the daily run is polling', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    status.tryStartPolling(); // the scheduler holds the slot

    const ctx = makeCtx({ userId: 1 });
    await bot.commands.get('check')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('уже идёт'));
    expect(watch.poll).not.toHaveBeenCalled();
  });

  it('/check releases the polling slot even when a subscription fails', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await bot.commands.get('check')!(makeCtx({ userId: 1 }));

    expect(status.tryStartPolling()).toBe(true); // free again
  });

  it('show-current denies a subscription that is not yours', async () => {
    subscriptions.listByUser.mockResolvedValue([]); // user 999 owns nothing
    const ctx = await pressButton('show:sub-1', 999);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Подписка не найдена.');
    expect(watch.current).not.toHaveBeenCalled();
  });

  it('/stats replies to the admin with counts', async () => {
    const adminBot = buildHandlers(makeAppConfig({ adminTelegramId: 99 }));
    subscriptions.countUsers.mockResolvedValue(3);
    subscriptions.countActive.mockResolvedValue(5);
    subscriptions.countPaused.mockResolvedValue(2);

    const ctx = makeCtx({ userId: 99 });
    await adminBot.commands.get('stats')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('пользователей: 3'));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('активных подписок: 5'));
  });

  it('/stats stays silent for a non-admin', async () => {
    const adminBot = buildHandlers(makeAppConfig({ adminTelegramId: 99 }));
    const ctx = makeCtx({ userId: 1 }); // not the admin

    await adminBot.commands.get('stats')!(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(subscriptions.countUsers).not.toHaveBeenCalled();
  });
});
