import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { DIGEST_LIMIT } from './telegram.format';
import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';
import { WatchScheduler } from './watch.scheduler';

const build = () => {
  const config = makeAppConfig();
  const subscriptions = new SubscriptionsService();
  const registry = new SourceRegistry(new KufarAdapter());
  const watch = new WatchService(subscriptions, registry);
  const telegram = new TelegramService(
    config,
    new TelegramHandlers(config, subscriptions, watch, registry),
  );
  const scheduler = new WatchScheduler(
    config,
    new SchedulerRegistry(),
    subscriptions,
    watch,
    telegram,
  );
  return { subscriptions, watch, telegram, scheduler };
};

describe('WatchScheduler.runDaily', () => {
  it('notifies per subscription and isolates a failing one', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    const failing = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    const healthy = subscriptions.add({ telegramUserId: 2, source: 'kufar', url: 'u2' });

    jest.spyOn(watch, 'check').mockImplementation((sub) => {
      if (sub.id === failing.id) throw new Error('boom');
      return Promise.resolve([listing(1)]);
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const notify = jest.spyOn(telegram, 'notify').mockResolvedValue();

    await scheduler.runDaily();

    // The healthy subscription is still delivered despite the other throwing.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(2, expect.stringContaining('🆕'));
    // Seen is marked only for the delivered subscription.
    expect([...subscriptions.getSeen(healthy.id)]).toEqual(['1']);
    expect(subscriptions.getSeen(failing.id).size).toBe(0);
  });

  it('marks only the delivered slice when fresh exceeds the digest cap', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u' });

    const overflow = Array.from({ length: DIGEST_LIMIT + 5 }, (_, i) => listing(i + 1));
    jest.spyOn(watch, 'check').mockResolvedValue(overflow);
    jest.spyOn(telegram, 'notify').mockResolvedValue();

    await scheduler.runDaily();

    // Overflow beyond the cap stays unseen so it surfaces on a later run.
    expect(subscriptions.getSeen(sub.id).size).toBe(DIGEST_LIMIT);
  });
});
