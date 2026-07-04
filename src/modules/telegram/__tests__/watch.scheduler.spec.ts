import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import type { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { WatchService } from '@/modules/subscriptions/watch.service';

import { DIGEST_LIMIT } from '../telegram.format';
import type { TelegramService } from '../telegram.service';
import { WatchScheduler } from '../watch.scheduler';

const sub = (id: number): Subscription =>
  ({ id: String(id), user: { telegramId: id }, source: 'kufar', url: `u${id}` }) as Subscription;

// Collaborators are mocked — the scheduler's job is orchestration, not persistence
// (the DB layer is covered by the integration e2e).
const build = () => {
  const subscriptions = { listAll: jest.fn() };
  const watch = { poll: jest.fn(), markSeen: jest.fn().mockResolvedValue(undefined) };
  const telegram = { notify: jest.fn().mockResolvedValue(undefined) };
  const scheduler = new WatchScheduler(
    makeAppConfig(),
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
    subscriptions.listAll.mockResolvedValue([sub(1), sub(2)]);
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
    subscriptions.listAll.mockResolvedValue([sub(1)]);
    watch.poll.mockResolvedValue({ kind: 'baselined', count: 3 });

    await scheduler.runDaily();

    expect(telegram.notify).not.toHaveBeenCalled();
    expect(watch.markSeen).not.toHaveBeenCalled();
  });

  it('marks only the delivered slice when fresh exceeds the digest cap', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listAll.mockResolvedValue([sub(1)]);
    const overflow = Array.from({ length: DIGEST_LIMIT + 5 }, (_, i) => listing(i + 1));
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: overflow });

    await scheduler.runDaily();

    expect(telegram.notify).toHaveBeenCalledTimes(1);
    // Only the delivered slice is marked seen; the overflow resurfaces next run.
    expect((watch.markSeen.mock.calls[0][1] as unknown[]).length).toBe(DIGEST_LIMIT);
  });

  it('does not mark seen when delivery fails — retried next run', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    subscriptions.listAll.mockResolvedValue([sub(1)]);
    watch.poll.mockResolvedValue({ kind: 'fresh', listings: [listing(1)] });
    telegram.notify.mockRejectedValue(new Error('403: bot was blocked'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await scheduler.runDaily();

    expect(watch.markSeen).not.toHaveBeenCalled();
  });
});
