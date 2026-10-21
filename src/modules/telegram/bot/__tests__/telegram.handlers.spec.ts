import { Logger } from '@nestjs/common';
import type { Bot } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing } from '@/__tests__/helpers/listing';
import { sentryCapture, sentryScope } from '@/__tests__/helpers/sentry';
import { sourceAdapter } from '@/__tests__/helpers/sources';
import { makeSubscription } from '@/__tests__/helpers/subscription';
import type { SourceRequestsService } from '@/modules/source-requests/source-requests.service';
import {
  ListingGoneError,
  PageNotFoundError,
  SearchRewrittenError,
  UnsupportedSearchError,
  UnwatchableItemError,
} from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import {
  DuplicateSubscriptionError,
  ProtectedLimitError,
  SubscriptionLimitError,
} from '@/modules/subscriptions/subscriptions.service';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';
import { WatchStatus } from '@/modules/telegram/watch/watch.status';

import type { CheckHandlers } from '../check.handlers';
import { ListHandlers } from '../list.handlers';
import { HELP_MESSAGE, PAGE_UNSUPPORTED } from '../telegram.format';
import { TelegramHandlers } from '../telegram.handlers';

import { makeCtx } from './fixtures/bot-ctx';
import { FakeBot } from './fixtures/fake-bot';

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
  let requests: { request: jest.Mock };
  // Real WatchStatus — dependency-free, and /stats reports its last run.
  let status: WatchStatus;

  const buildHandlers = (config = makeAppConfig()) => {
    const handlers = new TelegramHandlers(
      config,
      subscriptions as unknown as SubscriptionsService,
      watch as unknown as WatchService,
      new SourceRegistry([sourceAdapter('kufar')]),
      status,
      check as unknown as CheckHandlers,
      new ListHandlers(subscriptions as unknown as SubscriptionsService),
      requests as unknown as SourceRequestsService,
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
    watch = { baseline: jest.fn().mockResolvedValue([makeListing(1)]) };
    requests = { request: jest.fn().mockResolvedValue(false) };
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

  it.each([
    [true, 'передал заявку на его добавление и сообщу вам'],
    [false, 'Список сайтов, с которыми я работаю, — в /help'],
  ])('rejects an unsupported source, filing a request for it (filed: %s)', async (filed, text) => {
    requests.request.mockResolvedValue(filed);
    const ctx = makeCtx({ text: 'https://example.com/x', userId: 1 });
    await bot.onText(ctx);
    expect(requests.request).toHaveBeenCalledWith('https://example.com/x', 1);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(text));
  });

  it('refuses a page of a site we read without filing it as a new site', async () => {
    const ctx = makeCtx({ text: 'https://cars.av.by/filter?brands[0][brand]=6', userId: 1 });
    await bot.onText(ctx);
    expect(requests.request).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(PAGE_UNSUPPORTED);
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

  it('says the protected-source slots are taken instead of subscribing', async () => {
    subscriptions.add.mockRejectedValue(new ProtectedLimitError());
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk');
    const ctx = await pressButton(`subscribe:${nonce}`);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('защищён от ботов'));
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
    // Swallowed so the user is answered — so it must be reported.
    expect(sentryScope().setTag).toHaveBeenCalledWith('action', 'subscribe');
  });

  it('watches a pasted ad by its canonical link and names its title and price', async () => {
    watch.baseline.mockResolvedValue([makeListing(7, { title: 'Дом', priceByn: 202000 })]);
    const { ctx: prompt, nonce } = await pasteLink(
      'https://re.kufar.by/vi/grodno/kupit/dom/7?rank=3',
    );
    expect(prompt.reply).toHaveBeenCalledWith(
      expect.stringContaining('ценой этого объявления'),
      expect.anything(),
    );

    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(subscriptions.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://re.kufar.by/vi/7' }),
    );
    const [text] = ctx.editMessageText.mock.calls[0] as [string];
    expect(text).toContain('Слежу за объявлением «Дом»');
    expect(text).toContain('202');
  });

  it('refuses, honestly, an item link the site cannot be watched by yet', async () => {
    watch.baseline.mockRejectedValue(new UnwatchableItemError('hotel'));
    const { nonce } = await pasteLink('https://re.kufar.by/vi/7', 5);

    const ctx = await pressButton(`subscribe:${nonce}`, 5);

    expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 5);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('пока не слежу — пришлите ссылку на поиск'),
      expect.anything(),
    );
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  it('calls a duplicate ad link a duplicate ad, not a search', async () => {
    subscriptions.add.mockRejectedValue(new DuplicateSubscriptionError());
    const { nonce } = await pasteLink('https://re.kufar.by/vi/7');

    const ctx = await pressButton(`subscribe:${nonce}`);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Вы уже следите за этим объявлением'),
      expect.anything(),
    );
  });

  it('drops a watch on an ad that is already gone and says so', async () => {
    watch.baseline.mockRejectedValue(new ListingGoneError('gone'));
    const { nonce } = await pasteLink('https://re.kufar.by/vi/7', 5);

    const ctx = await pressButton(`subscribe:${nonce}`, 5);

    expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 5);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('уже снято'),
      expect.anything(),
    );
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  it('drops the subscription when the site answers 404 for the search', async () => {
    watch.baseline.mockRejectedValue(new PageNotFoundError('https://re.kufar.by/l/x', ''));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { nonce } = await pasteLink('https://re.kufar.by/l/x', 5);

    const ctx = await pressButton(`subscribe:${nonce}`, 5);

    expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 5);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Такой страницы на сайте нет'),
      expect.anything(),
    );
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  // The search behind the redirect is not the one the user chose, and every poll would hit it.
  it('drops the subscription and says why when the site rewrites the search', async () => {
    // Only realt pins its path in production; here the baseline is mocked, so the URLs are data.
    watch.baseline.mockRejectedValue(
      new SearchRewrittenError('https://re.kufar.by/l/minsk', 'https://re.kufar.by/l/belarus'),
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 5);

    const ctx = await pressButton(`subscribe:${nonce}`, 5);

    expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 5);
    const [text] = ctx.editMessageText.mock.calls[0] as [string];
    expect(text).toContain('https://re.kufar.by/l/minsk'); // what they sent
    expect(text).toContain('https://re.kufar.by/l/belarus'); // where the site took it
    // The link is user input, not our defect — nothing for Sentry.
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  it('drops the subscription and says why when leftover bid.cars filters cannot be mapped', async () => {
    watch.baseline.mockRejectedValue(
      new UnsupportedSearchError('https://re.kufar.by/l/minsk', ['damage']),
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { nonce } = await pasteLink('https://re.kufar.by/l/minsk', 5);

    const ctx = await pressButton(`subscribe:${nonce}`, 5);

    expect(subscriptions.remove).toHaveBeenCalledWith('sub-1', 5);
    const [text] = ctx.editMessageText.mock.calls[0] as [string];
    expect(text).toContain('damage');
    expect(text).toContain('https://re.kufar.by/l/minsk');
    expect(sentryCapture()).not.toHaveBeenCalled();
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
