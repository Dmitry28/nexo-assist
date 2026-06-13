import { Test } from '@nestjs/testing';

import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

// Wires the real SubscriptionsModule + SourcesModule graph (kufar fetch stubbed) and
// drives baseline → check through DI — the daily watch path minus the network.
describe('Watch flow (integration)', () => {
  let subscriptions: SubscriptionsService;
  let watch: WatchService;
  const kufar = new KufarAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SubscriptionsModule] })
      .overrideProvider(KufarAdapter)
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
    expect(fresh.map((l) => l.externalId)).toEqual(['2']);
  });
});
