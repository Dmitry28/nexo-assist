import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { makeListing as listing } from '@/__tests__/helpers/listing';
import { sourceAdapter } from '@/__tests__/helpers/sources';
import { DEFAULT_DATABASE_URL } from '@/config/env.validation';
import { InitSchema1783163228738 } from '@/database/migrations/1783163228738-InitSchema';
import { AddUsers1783179934781 } from '@/database/migrations/1783179934781-AddUsers';
import { AddNormalizedUrl1783187484846 } from '@/database/migrations/1783187484846-AddNormalizedUrl';
import { AddPausedAt1783195101942 } from '@/database/migrations/1783195101942-AddPausedAt';
import { AddConsecutiveFailures1783196783018 } from '@/database/migrations/1783196783018-AddConsecutiveFailures';
import { EnableRowLevelSecurity1785920305000 } from '@/database/migrations/1785920305000-EnableRowLevelSecurity';
import { AddLastNotifiedAt1791244800000 } from '@/database/migrations/1791244800000-AddLastNotifiedAt';
import { MoveTravelSubscriptions1791331200000 } from '@/database/migrations/1791331200000-MoveTravelSubscriptions';
import { RenormalizeSubscriptionUrls1791417600000 } from '@/database/migrations/1791417600000-RenormalizeSubscriptionUrls';
import { SeenListing } from '@/modules/subscriptions/entities/seen-listing.entity';
import { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { User } from '@/modules/subscriptions/entities/user.entity';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import {
  DuplicateSubscriptionError,
  MAX_SEEN_PER_SUBSCRIPTION,
  MAX_SUBSCRIPTIONS_PER_USER,
  SubscriptionLimitError,
  SubscriptionsService,
} from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

// Data-layer + watch flow against a real Postgres (docker locally, service in CI).
// Runs the real migration, so schema/entities/FK cascade are exercised for real.
describe('Subscriptions + watch (integration, real Postgres)', () => {
  let app: INestApplication;
  let subscriptions: SubscriptionsService;
  let watch: WatchService;
  let dataSource: DataSource;
  const kufar = sourceAdapter('kufar');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
          entities: [Subscription, SeenListing, User],
          // TODO [L]: hand-written — a new migration not listed here creates no table locally, so
          // the RLS invariant below passes. CI is covered (migration:run globs them first); switch
          // to the globbed path to close the local gap.
          migrations: [
            InitSchema1783163228738,
            AddUsers1783179934781,
            AddNormalizedUrl1783187484846,
            AddPausedAt1783195101942,
            AddConsecutiveFailures1783196783018,
            EnableRowLevelSecurity1785920305000,
            AddLastNotifiedAt1791244800000,
            MoveTravelSubscriptions1791331200000,
            RenormalizeSubscriptionUrls1791417600000,
          ],
          migrationsRun: true,
          synchronize: false,
        }),
        SubscriptionsModule,
      ],
    }).compile();
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
    // Isolate tests — cascade wipes seen_listings; users are wiped too (upsert re-creates).
    await dataSource.query('TRUNCATE TABLE subscriptions, users CASCADE');
  });

  it('persists a subscription with a generated id and lists it by user', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/u1',
    });
    expect(sub.id).toEqual(expect.any(String));
    // On the returned entity, not on a re-read: `save` leaves the eager relation unloaded, so
    // this is what tells us `add` reloads the row before handing it over.
    expect(sub.user.telegramId).toBe(1);

    const mine = await subscriptions.listByUser(1);
    expect(mine.map((s) => s.url)).toEqual(['https://kufar.by/l/u1']);
    expect(mine[0].normalizedUrl).toBe('https://kufar.by/l/u1'); // canonical form stored
    expect(mine[0].user.telegramId).toBe(1); // user relation loaded eagerly
    expect(await subscriptions.listByUser(2)).toEqual([]);
  });

  it('upserts the user by telegramId — one row, profile refreshed on re-subscribe', async () => {
    await subscriptions.add({
      user: { telegramId: 7, username: 'old' },
      source: 'kufar',
      url: 'https://kufar.by/l/a',
    });
    await subscriptions.add({
      user: { telegramId: 7, username: 'new' },
      source: 'kufar',
      url: 'https://kufar.by/l/b',
    });

    const users = await dataSource.query<{ username: string }[]>(
      `SELECT username FROM users WHERE "telegramId" = 7`,
    );
    expect(users).toEqual([{ username: 'new' }]); // single user, latest profile
  });

  it('baselines silently, then check reports only newly appeared listings', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    const fetch = jest.spyOn(kufar, 'fetch');

    fetch.mockResolvedValueOnce({ listings: [listing(1)], complete: true, capped: false });
    expect(await watch.baseline(sub)).toBe(1);

    fetch.mockResolvedValueOnce({
      listings: [listing(1), listing(2)],
      complete: true,
      capped: false,
    });
    const fresh = await watch.check(sub);
    expect(fresh.map((l) => l.externalId)).toEqual(['2']);
  });

  it('seedBaseline records seen and marks baselined atomically', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    await subscriptions.seedBaseline(sub.id, ['1', '2']);

    const [reloaded] = await subscriptions.listByUser(1);
    expect(reloaded.baselinedAt).toBeInstanceOf(Date);
    expect((await subscriptions.getSeen(sub.id, ['1', '2'])).size).toBe(2);
  });

  it('getSeen returns only the queried candidates already delivered; markSeen is idempotent', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    await subscriptions.markSeen(sub.id, ['1', '2']);
    await subscriptions.markSeen(sub.id, ['2', '3']); // '2' already seen — ignored, no error

    expect([...(await subscriptions.getSeen(sub.id, ['2', '3', '4']))].sort()).toEqual(['2', '3']);
  });

  it('MoveTravelSubscriptions re-points old travel links to kufar-travel and re-baselines them', async () => {
    const travel = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://travel.kufar.by/l/grodno/arendovat',
    });
    const sale = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://re.kufar.by/l/grodno/kupit/dom',
    });
    await subscriptions.seedBaseline(travel.id, ['stale']);
    await subscriptions.seedBaseline(sale.id, []);

    const runner = dataSource.createQueryRunner();
    await new MoveTravelSubscriptions1791331200000().up(runner).finally(() => runner.release());

    const rows = await subscriptions.listByUser(1);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(travel.id)).toMatchObject({ source: 'kufar-travel', baselinedAt: null });
    expect(byId.get(sale.id)).toMatchObject({ source: 'kufar', baselinedAt: expect.any(Date) });
    expect((await subscriptions.getSeen(travel.id, ['stale'])).size).toBe(0);
  });

  it('RenormalizeSubscriptionUrls keeps a key that is noise only on another source', async () => {
    // `page` is realt's paging param, not kufar's: kufar's row keeps it, realt's drops it.
    const kufarRow = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://re.kufar.by/l/x?page=2&sort=lst.d',
    });
    const realtRow = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'realt',
      url: 'https://realt.by/sale/plots/?page=2&rooms=1',
    });
    await dataSource.query(`UPDATE "subscriptions" SET "normalizedUrl" = 'stale-' || "id"`);

    const runner = dataSource.createQueryRunner();
    await new RenormalizeSubscriptionUrls1791417600000().up(runner).finally(() => runner.release());

    const byId = new Map((await subscriptions.listByUser(1)).map((r) => [r.id, r.normalizedUrl]));
    expect(byId.get(kufarRow.id)).toBe('https://re.kufar.by/l/x?page=2');
    expect(byId.get(realtRow.id)).toBe('https://realt.by/sale/plots?rooms=1');
  });

  // The quiet report counts from this stamp, against the real users table.
  it('markNotified stamps the user as just notified', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    const stamp = async () =>
      (
        await dataSource.query<{ lastNotifiedAt: Date | null }[]>(
          `SELECT "lastNotifiedAt" FROM users WHERE id = $1`,
          [sub.userId],
        )
      )[0].lastNotifiedAt;
    expect(await stamp()).toBeNull();

    await subscriptions.markNotified(sub.userId);

    expect(await stamp()).toBeInstanceOf(Date);
  });

  it('getSeen refreshes seenAt for in-window ids — pruning never drops still-visible listings', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    await subscriptions.markSeen(sub.id, ['1']);
    const [{ seenAt: before }] = await dataSource.query<{ seenAt: Date }[]>(
      `SELECT "seenAt" FROM seen_listings WHERE "subscriptionId" = $1`,
      [sub.id],
    );

    await new Promise((r) => setTimeout(r, 10));
    await subscriptions.getSeen(sub.id, ['1']);

    const [{ seenAt: after }] = await dataSource.query<{ seenAt: Date }[]>(
      `SELECT "seenAt" FROM seen_listings WHERE "subscriptionId" = $1`,
      [sub.id],
    );
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('prunes the seen set to the most recent MAX per subscription', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    const ids = Array.from({ length: MAX_SEEN_PER_SUBSCRIPTION + 5 }, (_, i) => `e${i}`);
    await subscriptions.markSeen(sub.id, ids);

    expect((await subscriptions.getSeen(sub.id, ids)).size).toBe(MAX_SEEN_PER_SUBSCRIPTION);
  });

  // Each source drops only its own paging/order keys — kufar's are `cursor` and `sort`.
  it('dedups the same search regardless of pagination/order/utm params', async () => {
    await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/minsk?cursor=a&sort=lst.d',
    });
    await expect(
      subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: 'https://kufar.by/l/minsk?cursor=b&utm_source=ad',
      }),
    ).rejects.toBeInstanceOf(DuplicateSubscriptionError);
  });

  it('rejects once the per-user subscription limit is reached', async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: `https://kufar.by/l/${i}`,
      });
    }
    await expect(
      subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: 'https://kufar.by/l/over',
      }),
    ).rejects.toBeInstanceOf(SubscriptionLimitError);
  });

  it('does not count paused subscriptions toward the per-user limit', async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: `https://kufar.by/l/${i}`,
      });
    }
    // Pause one so only MAX-1 remain active — a slot frees up for a live search.
    const [first] = await subscriptions.listByUser(1);
    await subscriptions.pause(first.id);

    const added = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/live',
    });
    expect(added.id).toBeDefined();
  });

  it('counts a revive toward the active limit', async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: `https://kufar.by/l/${i}`,
      });
    }
    // Pause one, then take the freed slot with a live search → MAX active + 1 paused.
    const [paused] = await subscriptions.listByUser(1);
    await subscriptions.pause(paused.id);
    await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/live',
    });
    // Re-sending the paused URL would revive it past the active cap → rejected.
    await expect(
      subscriptions.add({ user: { telegramId: 1 }, source: 'kufar', url: paused.url }),
    ).rejects.toBeInstanceOf(SubscriptionLimitError);
  });

  it('resume clears the pause and the failure streak, only for the owner', async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/dead',
    });
    await subscriptions.bumpFailures(sub.id);
    await subscriptions.pause(sub.id);

    expect(await subscriptions.resume(sub.id, 2)).toBe(false); // not their subscription
    expect(await subscriptions.resume(sub.id, 1)).toBe(true);

    const [revived] = await subscriptions.listActive();
    expect(revived.id).toBe(sub.id);
    expect(revived.consecutiveFailures).toBe(0);
  });

  it('resume respects the active-subscription limit', async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await subscriptions.add({
        user: { telegramId: 1 },
        source: 'kufar',
        url: `https://kufar.by/l/${i}`,
      });
    }
    // Pause one, refill the freed slot → resuming it would exceed the cap.
    const [paused] = await subscriptions.listByUser(1);
    await subscriptions.pause(paused.id);
    await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/live',
    });

    await expect(subscriptions.resume(paused.id, 1)).rejects.toBeInstanceOf(SubscriptionLimitError);
  });

  it('pauseAllForUser pauses every sub of a user; listActive then excludes them', async () => {
    const a = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/a',
    });
    await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/b',
    });
    const other = await subscriptions.add({
      user: { telegramId: 2 },
      source: 'kufar',
      url: 'https://kufar.by/l/c',
    });

    expect(await subscriptions.pauseAllForUser(a.userId)).toBe(2); // both of user 1's subs

    // Only user 1's subs are paused; user 2 (other) stays active.
    const active = await subscriptions.listActive();
    expect(active.map((s) => s.id)).toEqual([other.id]);
    // pausedAt is stamped on the paused rows.
    const [reloaded] = await subscriptions.listByUser(1);
    expect(reloaded.pausedAt).toBeInstanceOf(Date);
  });

  it('bumpFailures increments, resetFailures clears, and pause pauses one subscription', async () => {
    const s = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });

    await subscriptions.bumpFailures(s.id);
    await subscriptions.bumpFailures(s.id);
    expect((await subscriptions.listByUser(1))[0].consecutiveFailures).toBe(2);

    await subscriptions.resetFailures(s.id);
    expect((await subscriptions.listByUser(1))[0].consecutiveFailures).toBe(0);

    await subscriptions.pause(s.id);
    expect(await subscriptions.listActive()).toEqual([]); // paused → excluded
    const pausedAt = (await subscriptions.listByUser(1))[0].pausedAt;
    expect(pausedAt).toBeInstanceOf(Date);

    // Pausing again must not move the timestamp — /list shows it, and the 403 path may have
    // paused this row earlier in the same run.
    await subscriptions.pause(s.id);
    expect((await subscriptions.listByUser(1))[0].pausedAt).toEqual(pausedAt);
  });

  it('re-adding a paused search revives it (clears pause + failure streak, same row)', async () => {
    const s = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x?cursor=a',
    });
    await subscriptions.bumpFailures(s.id);
    await subscriptions.pause(s.id);
    expect(await subscriptions.listActive()).toEqual([]); // paused → not polled

    // Same search (volatile params differ → same normalizedUrl) — should revive, not duplicate.
    const revived = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x?cursor=b',
    });
    expect(revived.id).toBe(s.id); // same row, no duplicate created
    expect(revived.pausedAt).toBeNull();
    expect(revived.consecutiveFailures).toBe(0);
    expect((await subscriptions.listActive()).map((x) => x.id)).toEqual([s.id]); // active again
  });

  it("remove deletes only the owner's subscription and cascades its seen rows", async () => {
    const sub = await subscriptions.add({
      user: { telegramId: 1 },
      source: 'kufar',
      url: 'https://kufar.by/l/x',
    });
    await subscriptions.markSeen(sub.id, ['1']);

    expect(await subscriptions.remove(sub.id, 999)).toBe(false); // not the owner
    expect(await subscriptions.remove(sub.id, 1)).toBe(true);
    expect(await subscriptions.listByUser(1)).toEqual([]);
    // seen rows cascaded with the subscription
    expect((await subscriptions.getSeen(sub.id, ['1'])).size).toBe(0);
  });

  // The RLS migration enables it per a hand-written list, because RLS is not entity metadata:
  // `migration:generate` neither creates it nor reports its absence as drift. So a new table
  // arrives unprotected and nothing complains — until the provider's HTTP table API is switched
  // back on and reads it. Asserting the invariant instead of trusting the list makes that
  // impossible to forget: add a table without RLS and CI names it.
  it('has row-level security on every public table, and no policy that would re-open it', async () => {
    // 'r' and 'p': a partitioned table is 'p' and would otherwise be invisible here. Partition
    // children are NOT exempt — verified on Postgres: a child does not inherit relrowsecurity,
    // and reading it directly returns the rows the parent's RLS hides. The threat is an HTTP API
    // that enumerates tables in `public` one by one, which is exactly that direct path.
    const unprotected = await dataSource.query<{ table: string }[]>(`
      SELECT c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY c.relname
    `);
    expect(unprotected.map((r) => r.table)).toEqual([]);

    // The protection is "RLS enabled with NO policies". A permissive policy keeps the flag on
    // while re-opening the very path RLS closes, so the flag alone is not the guarantee.
    const policies = await dataSource.query<{ name: string }[]>(
      `SELECT policyname AS name FROM pg_policies WHERE schemaname = 'public'`,
    );
    expect(policies.map((r) => r.name)).toEqual([]);

    // Guard against a vacuous pass: an empty or half-migrated schema also yields no offenders.
    const tables = await dataSource.query<{ table: string }[]>(`
      SELECT tablename AS table FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    expect(tables.map((r) => r.table)).toEqual(
      expect.arrayContaining(['migrations', 'seen_listings', 'subscriptions', 'users']),
    );
  });
});
