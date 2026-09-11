import { Logger } from '@nestjs/common';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { sentryCapture, sentryScope } from '@/__tests__/helpers/sentry';
import { makeSubscription } from '@/__tests__/helpers/subscription';
import type { AppConfig } from '@/config/configuration';
import { AppEnv } from '@/config/env.validation';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';
import { WatchStatus } from '@/modules/telegram/watch/watch.status';

import { CheckHandlers } from '../check.handlers';
import { SEND_DELAY_MS } from '../telegram.deliver';

import { makeCtx } from './fixtures/bot-ctx';

const sub = (over: Partial<Subscription> = {}): Subscription =>
  makeSubscription({ url: 'u1', ...over });

// Collaborators are mocked — these tests cover the on-demand poll (the polling slot, pacing,
// what the user is told), not persistence (the DB layer is covered by the integration e2e).
describe('CheckHandlers', () => {
  let subscriptions: { listByUser: jest.Mock; findOwned: jest.Mock };
  let watch: { poll: jest.Mock; current: jest.Mock; markSeen: jest.Mock };
  // Real WatchStatus — dependency-free, and /check's polling slot is part of what is tested.
  let status: WatchStatus;
  let handlers: CheckHandlers;

  const buildHandlers = (config: AppConfig = makeAppConfig()) =>
    new CheckHandlers(
      config,
      subscriptions as unknown as SubscriptionsService,
      watch as unknown as WatchService,
      status,
    );

  beforeEach(() => {
    status = new WatchStatus();
    subscriptions = {
      listByUser: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(null),
    };
    watch = {
      poll: jest.fn(),
      current: jest.fn().mockResolvedValue([]),
      markSeen: jest.fn().mockResolvedValue(undefined),
    };
    handlers = buildHandlers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const tapShow = async (id: string, from = 1) => {
    const ctx = makeCtx({ userId: from });
    await handlers.onShowCurrent(ctx, id);
    return ctx;
  };

  it('/check baselines a pending subscription instead of flooding it as new', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockResolvedValue({ kind: 'baselined', count: 2 });

    const ctx = makeCtx({ userId: 1 });
    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('объявлений сейчас: 2'),
      expect.anything(),
    );
    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('/check replies with a card per listing and marks the delivered items seen', async () => {
    jest.useFakeTimers();
    const s = sub({ url: 'u1' });
    subscriptions.listByUser.mockResolvedValue([s]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1), listing(2)] });

    const ctx = makeCtx({ userId: 1 });
    const run = handlers.onCheck(ctx);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 2);
    await run;

    // No photos on these listings, so each card is a message of its own.
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('🆕 1/2'),
      expect.objectContaining({ parse_mode: 'HTML' }),
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
    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('🏠'),
      expect.objectContaining({ parse_mode: 'HTML' }),
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
    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Не получилось проверить'));
    expect(ctx.reply).not.toHaveBeenCalledWith('Ничего нового.');
  });

  it('/check says the digest did not go out when the send fails outright', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    const ctx = makeCtx({ userId: 1 });
    ctx.reply.mockRejectedValueOnce(new Error('telegram 500')); // the digest message itself
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Не получилось отправить объявления по поиску на kufar'),
    );
    expect(watch.markSeen).not.toHaveBeenCalled(); // nothing arrived — retry next run
  });

  it('/check tells the user the rest is coming when only part of it went out', async () => {
    jest.useFakeTimers();
    const s = sub({ url: 'u1' });
    subscriptions.listByUser.mockResolvedValue([s]);
    watch.poll.mockResolvedValue({
      kind: 'fresh',
      listings: Array.from({ length: 5 }, (_, i) => listing(i + 1)),
    });
    const ctx = makeCtx({ userId: 1 });
    // The first card arrives, the second does not.
    ctx.reply.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('telegram 500'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const run = handlers.onCheck(ctx);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 5);
    await run;

    expect(ctx.reply).toHaveBeenCalledWith(
      'Часть объявлений не отправилась — пришлю в следующую проверку.',
    );
    // What did arrive is recorded, so the next run sends the remainder and not a duplicate.
    expect((watch.markSeen.mock.calls[0][1] as unknown[]).length).toBe(1);
  });

  it('/check answers the owner in production — the only live check without waiting for the cron', async () => {
    const prod = buildHandlers(makeAppConfig({ appEnv: AppEnv.Production, adminTelegramId: 99 }));
    subscriptions.listByUser.mockResolvedValue([]);

    const ctx = makeCtx({ userId: 99 });
    await prod.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Пока нет ни одной подписки'));
  });

  it('/check stays silent for a non-owner in production', async () => {
    const prod = buildHandlers(makeAppConfig({ appEnv: AppEnv.Production, adminTelegramId: 99 }));

    const ctx = makeCtx({ userId: 1 });
    await prod.onCheck(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(subscriptions.listByUser).not.toHaveBeenCalled();
  });

  it('/check announces the batch and polls every subscription in it', async () => {
    // Zero delays: the paced loop would otherwise really sleep between subscriptions.
    const fast = buildHandlers(makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }));
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1' }), sub({ id: 's2' })]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    const ctx = makeCtx({ userId: 1 });
    await fast.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Проверяю подписок: 2'));
    expect(watch.poll).toHaveBeenCalledTimes(2);
  });

  // grammY handles updates sequentially, so the paced loop blocks every other user while it
  // runs. Without the cap a user at the subscription limit would freeze the bot for minutes.
  it('/check polls at most five subscriptions and says the check was capped', async () => {
    const fast = buildHandlers(makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }));
    subscriptions.listByUser.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => sub({ id: `s${i}` })),
    );
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    const ctx = makeCtx({ userId: 1 });
    await fast.onCheck(ctx);

    expect(watch.poll).toHaveBeenCalledTimes(5);
    // Said out loud, or a capped check reads as a full one and the rest looks quiet.
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Проверяю подписок: 5 из 7'));
  });

  it('/check skips paused subscriptions — the daily run does not poll them either', async () => {
    const fast = buildHandlers(makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }));
    subscriptions.listByUser.mockResolvedValue([
      sub({ id: 'paused', pausedAt: new Date() }),
      sub({ id: 'active' }),
    ]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    await fast.onCheck(makeCtx({ userId: 1 }));

    expect(watch.poll).toHaveBeenCalledTimes(1);
    expect(watch.poll).toHaveBeenCalledWith(expect.objectContaining({ id: 'active' }));
  });

  it('/check says so when every subscription is paused', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ id: 's1', pausedAt: new Date() })]);

    const ctx = makeCtx({ userId: 1 });
    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('на паузе'));
    expect(watch.poll).not.toHaveBeenCalled();
  });

  it('/check refuses to start while the daily run is polling', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    status.tryStartPolling(); // the scheduler holds the slot

    const ctx = makeCtx({ userId: 1 });
    await handlers.onCheck(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Идёт проверка объявлений'));
    expect(watch.poll).not.toHaveBeenCalled();
  });

  it('/check releases the polling slot even when a subscription fails', async () => {
    subscriptions.listByUser.mockResolvedValue([sub({ url: 'u1' })]);
    watch.poll.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handlers.onCheck(makeCtx({ userId: 1 }));

    expect(status.tryStartPolling()).toBe(true); // free again
  });

  it('show-current denies a subscription that is not yours', async () => {
    subscriptions.findOwned.mockResolvedValue(null); // user 999 does not own sub-1
    const ctx = await tapShow('sub-1', 999);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Подписка не найдена.');
    expect(watch.current).not.toHaveBeenCalled();
    // The id comes from callback_data, so the sender must be part of the lookup — a stubbed
    // null would pass even if this looked the subscription up by id alone.
    expect(subscriptions.findOwned).toHaveBeenCalledWith('sub-1', 999);
  });

  it('show-current refuses while a poll is in progress — it hits the source like /check', async () => {
    subscriptions.findOwned.mockResolvedValue(sub({ id: 'sub-1' }));
    status.tryStartPolling(); // the scheduler holds the slot

    const ctx = await tapShow('sub-1');

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.stringContaining('Идёт проверка объявлений'),
    );
    expect(watch.current).not.toHaveBeenCalled();
    // The refusal must not release the slot it never took — that would free the daily run's one.
    expect(status.tryStartPolling()).toBe(false);
  });

  it('show-current ignores a stale callback answer — the fetch still runs', async () => {
    subscriptions.findOwned.mockResolvedValue(sub({ id: 'sub-1' }));
    const ctx = makeCtx({ userId: 1 });
    // Telegram invalidates a callback after ~15s, but the button stays tappable forever.
    ctx.answerCallbackQuery.mockRejectedValue(new Error('query is too old'));

    await handlers.onShowCurrent(ctx, 'sub-1');

    expect(watch.current).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('Не получилось загрузить'));
    expect(sentryCapture()).not.toHaveBeenCalled();
  });

  it('show-current never claims the slot — a tap must not cost everyone the daily run', async () => {
    subscriptions.findOwned.mockResolvedValue(sub({ id: 'sub-1' }));
    // Hold the fetch open so the assertion lands while the button is mid-work.
    let finishFetch = (): void => undefined;
    watch.current.mockReturnValue(
      new Promise((resolve) => {
        finishFetch = () => resolve([]);
      }),
    );

    const tap = tapShow('sub-1');
    await Promise.resolve();

    // runDaily abandons the run when the slot is taken, so a tap holding it would silence the
    // bot for every user until tomorrow.
    expect(status.tryStartPolling()).toBe(true);
    status.finishPolling();
    finishFetch();
    await tap;
    expect(watch.current).toHaveBeenCalledTimes(1);
  });

  it('show-current replies with the listings it fetched', async () => {
    subscriptions.findOwned.mockResolvedValue(sub({ id: 'sub-1' }));
    watch.current.mockResolvedValue([listing(1), listing(2)]);

    const ctx = await tapShow('sub-1');

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Объявлений сейчас: 2'),
      expect.anything(),
    );
  });

  it('show-current reports a failed fetch and does not escalate a failed apology', async () => {
    subscriptions.findOwned.mockResolvedValue(sub({ id: 'sub-1' }));
    watch.current.mockRejectedValue(new Error('outage'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = makeCtx({ userId: 1 });
    // Telegram is the thing that is down — the apology fails over the same broken channel.
    ctx.reply.mockRejectedValue(new Error('telegram down'));

    await expect(handlers.onShowCurrent(ctx, 'sub-1')).resolves.toBeUndefined(); // never bot.catch

    expect(sentryScope().setTag).toHaveBeenCalledWith('action', 'show-current');
    // Tagged like the cron's poll failures: an `op:poll` filter that skipped this path would
    // quietly show only the scheduled run, and the context says which search broke.
    expect(sentryScope().setTag).toHaveBeenCalledWith('op', 'poll');
    expect(sentryScope().setContext).toHaveBeenCalledWith(
      'subscription',
      expect.objectContaining({ id: 'sub-1', source: 'kufar' }),
    );
  });
});
