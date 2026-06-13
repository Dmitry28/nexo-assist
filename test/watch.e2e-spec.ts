import { Test } from '@nestjs/testing';

import type { KufarListing } from '@/modules/kufar/entities/kufar-listing.entity';
import { KufarService } from '@/modules/kufar/kufar.service';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

const listing = (adId: number): KufarListing => ({
  adId,
  link: `https://re.kufar.by/vi/${adId}`,
  title: `t${adId}`,
  listTime: '2026-01-01T00:00:00Z',
  images: [],
});

// Wires the real SubscriptionsModule + KufarModule graph (Kufar fetch stubbed) and
// drives baseline → check through DI — the daily watch path minus the network.
describe('Watch flow (integration)', () => {
  let subscriptions: SubscriptionsService;
  let watch: WatchService;
  const kufar = new KufarService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SubscriptionsModule] })
      .overrideProvider(KufarService)
      .useValue(kufar)
      .compile();
    subscriptions = moduleRef.get(SubscriptionsService);
    watch = moduleRef.get(WatchService);
  });

  it('baselines silently then reports only newly appeared listings', async () => {
    const sub = subscriptions.add({
      telegramUserId: 1,
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    const fetch = jest.spyOn(kufar, 'fetch');

    fetch.mockResolvedValueOnce([listing(1)]);
    const seeded = await watch.baseline(sub);

    fetch.mockResolvedValueOnce([listing(1), listing(2)]);
    const fresh = await watch.check(sub);

    expect(seeded).toEqual({ supported: true, count: 1 });
    expect(fresh.map((l) => l.adId)).toEqual([2]);
  });
});
