import { Logger } from '@nestjs/common';
import type { Bot, Context } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeSubscription } from '@/__tests__/helpers/subscription';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  SubscriptionLimitError,
} from '@/modules/subscriptions/subscriptions.service';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';
import { WatchStatus } from '@/modules/telegram/watch/watch.status';

import type { CheckHandlers } from '../check.handlers';
import { HELP_MESSAGE } from '../telegram.format';
import { TelegramHandlers } from '../telegram.handlers';

import { makeCtx } from './fixtures/bot-ctx';

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

const sub = (over: Partial<Subscription> = {}): Subscription =>
  makeSubscription({ url: 'u1', ...over });

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
  let watch: { baseline: jest.Mock };
  let check: { onCheck: jest.Mock; onShowCurrent: jest.Mock };
  // Real WatchStatus — dependency-free, and /stats reports its last run.
  let status: WatchStatus;

  const buildHandlers = (config = makeAppConfig()) => {
    const handlers = new TelegramHandlers(
      config,
      subscriptions as unknown as SubscriptionsService,
      watch as unknown as WatchService,
      new SourceRegistry([new KufarAdapter()]),
      status,
      check as unknown as CheckHandlers,
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
    watch = { baseline: jest.fn().mockResolvedValue(1) };
    check = {
      onCheck: jest.fn().mockResolvedValue(undefined),
      onShowCurrent: jest.fn().mockResolvedValue(undefined),
    };
    bot = buildHandlers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // NOTE: 'anonymous' rather than `undefined` — a default parameter fires on an explicit
  // `undefined`, so that could not express "a sender-less update" at a call site.
  const pressButton = async (data: string, from: number | 'anonymous' = 1) => {
    const entry = bot.callbacks.find((c) => c.pattern.test(data));
    if (!entry) throw new Error(`no handler for ${data}`);
    const userId = from === 'anonymous' ? undefined : from;
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

  it('cancel answers the callback before editing — a failed edit must not keep it spinning', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const ctx = await pressButton(`cancel:${nonce}`);

    expect(ctx.answerCallbackQuery.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.editMessageText.mock.invocationCallOrder[0],
    );
  });

  it('cancel still edits the message when a stale callback answer throws', async () => {
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const data = `cancel:${nonce}`;
    const entry = bot.callbacks.find((c) => c.pattern.test(data))!;
    const ctx = makeCtx({ userId: 1, match: data.match(entry.pattern) ?? undefined });
    // Answering first must not cost the user the confirmation: a callback older than ~15s throws.
    ctx.answerCallbackQuery.mockRejectedValue(new Error('query is too old'));

    await entry.fn(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith('Отменено.');
  });

  it('/help replies with the help text', async () => {
    const ctx = makeCtx({ userId: 1 });

    await buildHandlers().commands.get('help')!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(HELP_MESSAGE, expect.anything());
  });

  // Routing lives here alone: the on-demand poll owns the behaviour (CheckHandlers), this
  // module owns which update reaches it.
  it('/check is routed to CheckHandlers', async () => {
    const ctx = makeCtx({ userId: 1 });

    await bot.commands.get('check')!(ctx);

    expect(check.onCheck).toHaveBeenCalledWith(ctx);
  });

  it('a show: tap reaches CheckHandlers with the tapped subscription id', async () => {
    const ctx = await pressButton('show:sub-1', 1);

    expect(check.onShowCurrent).toHaveBeenCalledWith(ctx, 'sub-1');
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

  // The spinner is the only feedback a tap gives. An unanswered callback keeps spinning until
  // Telegram times it out, which reads as a dead bot — so even a malformed one must be answered.
  it.each(['remove:s1', 'resume:s1'])('clears the spinner on an anonymous %s tap', async (data) => {
    const ctx = await pressButton(data, 'anonymous');

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(subscriptions.remove).not.toHaveBeenCalled();
    expect(subscriptions.resume).not.toHaveBeenCalled();
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
