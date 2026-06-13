import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { makeAppConfig } from '@/__tests__/helpers/app-config';
import type { KufarListing } from '@/modules/kufar/entities/kufar-listing.entity';
import { KufarService } from '@/modules/kufar/kufar.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';
import { WatchScheduler } from './watch.scheduler';

const listing = (adId: number): KufarListing => ({
  adId,
  link: `https://re.kufar.by/vi/${adId}`,
  title: `t${adId}`,
  listTime: '2026-01-01T00:00:00Z',
  images: [],
});

describe('WatchScheduler.runDaily', () => {
  it('notifies per subscription and isolates a failing one', async () => {
    const config = makeAppConfig();
    const subscriptions = new SubscriptionsService();
    const failing = subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    subscriptions.add({ telegramUserId: 2, source: 'kufar', url: 'u2' });

    const watch = new WatchService(subscriptions, new KufarService());
    jest.spyOn(watch, 'check').mockImplementation((sub) => {
      if (sub.id === failing.id) throw new Error('boom');
      return Promise.resolve([listing(1)]);
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const telegram = new TelegramService(
      config,
      new TelegramHandlers(config, subscriptions, watch),
    );
    const notify = jest.spyOn(telegram, 'notify').mockResolvedValue();

    const scheduler = new WatchScheduler(
      config,
      new SchedulerRegistry(),
      subscriptions,
      watch,
      telegram,
    );

    await scheduler.runDaily();

    // The healthy subscription is still delivered despite the other throwing.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(2, expect.stringContaining('🆕'));
  });
});
