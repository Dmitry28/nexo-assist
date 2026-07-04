import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GrammyError } from 'grammy';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';

import { DIGEST_LIMIT } from '../telegram.format';
import type { TelegramService } from '../telegram.service';
import { jitteredDelay, MAX_CONSECUTIVE_FAILURES, WatchScheduler } from '../watch.scheduler';

const sub = (id: number, userId = id, consecutiveFailures = 0): Subscription =>
  ({
    id: String(id),
    userId: String(userId),
    user: { telegramId: userId },
    source: 'kufar',
    url: `u${id}`,
    consecutiveFailures,
  }) as Subscription;

// Collaborators are mocked — the scheduler's job is orchestration, not persistence
// (the DB layer is covered by the integration e2e).
const build = () => {
  const subscriptions = {
    listActive: jest.fn(),
    pauseAllForUser: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    bumpFailures: jest.fn().mockResolvedValue(undefined),
    resetFailures: jest.fn().mockResolvedValue(undefined),
  };
  const watch = { poll: jest.fn(), markSeen: jest.fn().mockResolvedValue(undefined) };
  const telegram = { notify: jest.fn().mockResolvedValue(undefined) };
  const scheduler = new WatchScheduler(
    // No pacing delay under tests — the jitter math is covered separately.
    makeAppConfig({ watchMinDelayMs: 0, watchJitterMs: 0 }),
    new SchedulerRegistry(),
    subscriptions as unknown as SubscriptionsService,
    watch as unknown as WatchService,
    telegram as unknown as TelegramService,
  );
  return { subscriptions, watch, telegram, scheduler };
};

describe('WatchScheduler.runDaily', () => {
  afterEach(() => jest.restoreAllMocks());

  it('delivers fresh outcomes and isolates a failing subscription', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1), sub(2)]);
    watch.poll.mockImplementation((s: Subscription) => {
      if (s.id === '1') throw new Error('boom');
      return Promise.resolve({ kind: 'fresh', listings: [listing(1)] });
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    // Sub 2 is still delivered despite sub 1 throwing.
    expect(telegram.notify).toHaveBeenCalledTimes(1);
    expect(telegram.notify).toHaveBeenCalledWith(2, expect.stringContaining('🆕'));
    expect(watch.markSeen).toHaveBeenCalledTimes(1);
  });

  it('does not notify for non-fresh outcomes (baselined / nothing)', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1)]);
    watch.poll.mockResolvedValue({ kind: 'baselined', count: 3 });

    await scheduler.runDaily();

    expect(telegram.notify).not.toHaveBeenCalled();
    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('marks only the delivered slice when fresh exceeds the digest cap', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1)]);
    const overflow = Array.from({ length: DIGEST_LIMIT + 5 }, (_, i) => listing(i + 1));
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: overflow });

    await scheduler.runDaily();

    expect(telegram.notify).toHaveBeenCalledTimes(1);
    // Only the delivered slice is marked seen; the overflow resurfaces next run.
    expect((watch.markSeen.mock.calls[0][1] as unknown[]).length).toBe(DIGEST_LIMIT);
  });

  it('does not mark seen when delivery fails — retried next run', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1)]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    telegram.notify.mockRejectedValue(new Error('403: bot was blocked'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('auto-pauses a user on 403 and skips their remaining subscriptions', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    // Two subs owned by the same user (userId 1).
    subscriptions.listActive.mockResolvedValue([sub(1, 1), sub(2, 1)]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    const blocked = Object.assign(Object.create(GrammyError.prototype) as GrammyError, {
      error_code: 403,
    });
    telegram.notify.mockRejectedValue(blocked);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(subscriptions.pauseAllForUser).toHaveBeenCalledWith('1');
    expect(telegram.notify).toHaveBeenCalledTimes(1); // second sub skipped, not re-attempted
    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('keeps running when the pause write fails after a 403', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    // User 1 (403 + pause fails), then user 2 must still be delivered.
    subscriptions.listActive.mockResolvedValue([sub(1, 1), sub(2, 2)]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    const blocked = Object.assign(Object.create(GrammyError.prototype) as GrammyError, {
      error_code: 403,
    });
    telegram.notify.mockRejectedValueOnce(blocked).mockResolvedValue(undefined);
    subscriptions.pauseAllForUser.mockRejectedValue(new Error('db down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(telegram.notify).toHaveBeenCalledTimes(2); // user 2 still attempted
    expect(telegram.notify).toHaveBeenLastCalledWith(2, expect.stringContaining('🆕'));
  });

  it('bumps the failure streak on a poll error without warning below the threshold', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1, 1, 0)]); // 0 prior failures
    watch.poll.mockRejectedValue(new Error('source down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(subscriptions.bumpFailures).toHaveBeenCalledWith('1');
    expect(subscriptions.pause).not.toHaveBeenCalled();
    expect(telegram.notify).not.toHaveBeenCalled();
  });

  it('warns the user and pauses the subscription at the failure threshold', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    // one short of the cap → this run trips it
    subscriptions.listActive.mockResolvedValue([sub(1, 1, MAX_CONSECUTIVE_FAILURES - 1)]);
    watch.poll.mockRejectedValue(new Error('source down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(subscriptions.bumpFailures).toHaveBeenCalledWith('1');
    expect(telegram.notify).toHaveBeenCalledWith(1, expect.stringContaining('paused'));
    expect(subscriptions.pause).toHaveBeenCalledWith('1');
  });

  it('does not bump the dead-link streak when delivery fails (only poll errors count)', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1, 1, 0)]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] }); // poll OK
    telegram.notify.mockRejectedValue(new Error('telegram 500')); // delivery fails, non-403
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(subscriptions.bumpFailures).not.toHaveBeenCalled();
    expect(watch.markSeen).not.toHaveBeenCalled(); // retried next run
  });

  it('resets the failure streak after a successful poll, and skips the write when already zero', async () => {
    const { subscriptions, watch, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1, 1, 3), sub(2, 2, 0)]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });

    await scheduler.runDaily();

    expect(subscriptions.resetFailures).toHaveBeenCalledTimes(1); // only sub 1 (had a streak)
    expect(subscriptions.resetFailures).toHaveBeenCalledWith('1');
  });

  it('paces between polls only — N-1 delays for N subscriptions, none before the first', async () => {
    const { subscriptions, watch, scheduler } = build();
    subscriptions.listActive.mockResolvedValue([sub(1), sub(2), sub(3)]);
    watch.poll.mockResolvedValue({ kind: 'nothing' });
    const timeout = jest.spyOn(global, 'setTimeout');

    await scheduler.runDaily();

    expect(timeout).toHaveBeenCalledTimes(2); // between 3 polls, not before the first
  });
});

describe('jitteredDelay', () => {
  it('returns the base with no jitter, and stays within [min, min+jitter]', () => {
    expect(jitteredDelay(2000, 0)).toBe(2000);
    expect(jitteredDelay(2000, 3000, () => 0)).toBe(2000); // low end
    expect(jitteredDelay(2000, 3000, () => 0.999999)).toBe(5000); // high end
  });
});
