import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { makeListing as listing } from '@/__tests__/helpers/listing';
import { DEFAULT_DATABASE_URL } from '@/config/env.validation';
import { InitSchema1783163228738 } from '@/database/migrations/1783163228738-InitSchema';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SeenListing } from '@/modules/subscriptions/entities/seen-listing.entity';
import { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

// Data-layer + watch flow against a real Postgres (docker locally, service in CI).
// Runs the real migration, so schema/entities/FK cascade are exercised for real.
describe('Subscriptions + watch (integration, real Postgres)', () => {
  let app: INestApplication;
  let subscriptions: SubscriptionsService;
  let watch: WatchService;
  let dataSource: DataSource;
  const kufar = new KufarAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
          entities: [Subscription, SeenListing],
          migrations: [InitSchema1783163228738],
          migrationsRun: true,
          synchronize: false,
        }),
        SubscriptionsModule,
      ],
    })
      .overrideProvider(KufarAdapter)
      .useValue(kufar)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    subscriptions = moduleRef.get(SubscriptionsService);
    watch = moduleRef.get(WatchService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // Isolate tests — the FK cascade wipes seen_listings with it.
    await dataSource.query('TRUNCATE TABLE subscriptions CASCADE');
  });

  it('persists a subscription with a generated id and lists it by user', async () => {
    const sub = await subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u1' });
    expect(sub.id).toEqual(expect.any(String));

    const mine = await subscriptions.listByUser(1);
    expect(mine.map((s) => s.url)).toEqual(['u1']);
    expect(await subscriptions.listByUser(2)).toEqual([]);
  });

  it('baselines silently, then check reports only newly appeared listings', async () => {
    const sub = await subscriptions.add({
      telegramUserId: 1,
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    const fetch = jest.spyOn(kufar, 'fetch');

    fetch.mockResolvedValueOnce([listing(1)]);
    expect(await watch.baseline(sub)).toBe(1);

    fetch.mockResolvedValueOnce([listing(1), listing(2)]);
    const fresh = await watch.check(sub);
    expect(fresh.map((l) => l.externalId)).toEqual(['2']);
  });

  it('seedBaseline records seen and marks baselined atomically', async () => {
    const sub = await subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u' });
    await subscriptions.seedBaseline(sub.id, ['1', '2']);

    const [reloaded] = await subscriptions.listByUser(1);
    expect(reloaded.baselinedAt).toBeInstanceOf(Date);
    expect((await subscriptions.getSeen(sub.id, ['1', '2'])).size).toBe(2);
  });

  it('getSeen returns only the queried candidates already delivered; markSeen is idempotent', async () => {
    const sub = await subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u' });
    await subscriptions.markSeen(sub.id, ['1', '2']);
    await subscriptions.markSeen(sub.id, ['2', '3']); // '2' already seen — ignored, no error

    expect([...(await subscriptions.getSeen(sub.id, ['2', '3', '4']))].sort()).toEqual(['2', '3']);
  });

  it("remove deletes only the owner's subscription and cascades its seen rows", async () => {
    const sub = await subscriptions.add({ telegramUserId: 1, source: 'kufar', url: 'u' });
    await subscriptions.markSeen(sub.id, ['1']);

    expect(await subscriptions.remove(sub.id, 999)).toBe(false); // not the owner
    expect(await subscriptions.remove(sub.id, 1)).toBe(true);
    expect(await subscriptions.listByUser(1)).toEqual([]);
    // seen rows cascaded with the subscription
    expect((await subscriptions.getSeen(sub.id, ['1'])).size).toBe(0);
  });
});
