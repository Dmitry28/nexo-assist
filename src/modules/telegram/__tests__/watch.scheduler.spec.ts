import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { DIGEST_LIMIT } from '../telegram.format';
import { TelegramHandlers } from '../telegram.handlers';
import { TelegramService } from '../telegram.service';
import { WatchScheduler } from '../watch.scheduler';

const build = () => {
  const config = makeAppConfig();
  const subscriptions = new SubscriptionsService();
  const registry = new SourceRegistry([new KufarAdapter()]);
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
  // Subscriptions in these tests are pre-baselined; the pending-baseline path has its own test.
  const addBaselined = (telegramUserId: number, url: string) => {
    const sub = subscriptions.add({ telegramUserId, source: 'kufar', url });
    subscriptions.markBaselined(sub.id);
    return sub;
  };
  return { subscriptions, watch, telegram, scheduler, addBaselined };
};

describe('WatchScheduler.runDaily', () => {
  it('notifies per subscription and isolates a failing one', async () => {
    const { subscriptions, watch, telegram, scheduler, addBaselined } = build();
    const failing = addBaselined(1, 'u1');
    const healthy = addBaselined(2, 'u2');

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
    const { subscriptions, watch, telegram, scheduler, addBaselined } = build();
    const sub = addBaselined(1, 'u');

    const overflow = Array.from({ length: DIGEST_LIMIT + 5 }, (_, i) => listing(i + 1));
    jest.spyOn(watch, 'check').mockResolvedValue(overflow);
    jest.spyOn(telegram, 'notify').mockResolvedValue();

    await scheduler.runDaily();

    // Overflow beyond the cap stays unseen so it surfaces on a later run.
    expect(subscriptions.getSeen(sub.id).size).toBe(DIGEST_LIMIT);
  });

  it('keeps listings unseen when the delivery fails — retried next run', async () => {
    const { subscriptions, watch, telegram, scheduler, addBaselined } = build();
    const sub = addBaselined(1, 'u');
    jest.spyOn(watch, 'check').mockResolvedValue([listing(1)]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(telegram, 'notify').mockRejectedValue(new Error('403: bot was blocked'));

    await scheduler.runDaily();

    expect(subscriptions.getSeen(sub.id).size).toBe(0);
  });

  it('baselines a pending subscription silently instead of flooding it as new', async () => {
    const { subscriptions, watch, telegram, scheduler } = build();
    // No markBaselined — e.g. the on-subscribe baseline failed.
    const sub = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u' });

    const baseline = jest.spyOn(watch, 'baseline').mockImplementation((s) => {
      subscriptions.markSeen(s.id, ['1']);
      subscriptions.markBaselined(s.id);
      return Promise.resolve(1);
    });
    const check = jest.spyOn(watch, 'check');
    const notify = jest.spyOn(telegram, 'notify').mockResolvedValue();

    await scheduler.runDaily();

    expect(baseline).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sub.baselinedAt).toBeInstanceOf(Date);
  });
});
