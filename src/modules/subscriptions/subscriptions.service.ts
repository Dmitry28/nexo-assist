import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { normalizeUrl } from '@/common/url';
import type { SourceId } from '@/modules/sources/source-adapter';

import { SeenListing } from './entities/seen-listing.entity';
import { Subscription } from './entities/subscription.entity';
import { User } from './entities/user.entity';

// Cap on stored seen rows per subscription. Kept above the source page-cap window
// (MAX_PAGES × page size ≈ 150, see paginate.ts) so ids still reachable are never
// pruned — anything older has fallen out of the window and can't reappear as "new".
export const MAX_SEEN_PER_SUBSCRIPTION = 300;

// Anti-abuse: cap subscriptions per user (also keeps /list within Telegram's limits).
export const MAX_SUBSCRIPTIONS_PER_USER = 50;

/** The user already watches this search (matched by normalized URL). */
export class DuplicateSubscriptionError extends Error {}
/** The user hit MAX_SUBSCRIPTIONS_PER_USER. */
export class SubscriptionLimitError extends Error {}

/** Telegram account details captured from `ctx.from` at subscribe time. */
export interface TelegramUserProfile {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  language?: string;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(SeenListing) private readonly seen: Repository<SeenListing>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async add(input: {
    user: TelegramUserProfile;
    source: SourceId;
    url: string;
  }): Promise<Subscription> {
    const user = await this.upsertUser(input.user);
    // Dedup on the normalized URL (a unique index backs it); the bot flow is sequential,
    // so the check-then-insert TOCTOU race is negligible.
    const normalizedUrl = normalizeUrl(input.url);
    if (await this.subs.existsBy({ userId: user.id, normalizedUrl })) {
      throw new DuplicateSubscriptionError();
    }
    if ((await this.subs.countBy({ userId: user.id })) >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new SubscriptionLimitError();
    }
    try {
      return await this.subs.save(
        this.subs.create({ userId: user.id, source: input.source, url: input.url, normalizedUrl }),
      );
    } catch (err) {
      // The unique index is the real guard — map a race that beat the existsBy check.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new DuplicateSubscriptionError();
      }
      throw err;
    }
  }

  has(id: string): Promise<boolean> {
    return this.subs.existsBy({ id });
  }

  listByUser(telegramUserId: number): Promise<Subscription[]> {
    // Ordered so /list numbering is stable across invocations.
    return this.subs.find({
      where: { user: { telegramId: telegramUserId } },
      order: { createdAt: 'ASC' },
    });
  }

  /** Subscriptions the scheduler should poll — active only (paused ones are skipped). */
  listActive(): Promise<Subscription[]> {
    return this.subs.find({ where: { pausedAt: IsNull() } });
  }

  /**
   * Pause every currently-active subscription of a user — used after a Telegram 403
   * (the user blocked the bot), so we stop scraping/delivering for them. Only touches
   * active rows, so an existing pause timestamp is preserved.
   */
  async pauseAllForUser(userId: string): Promise<void> {
    await this.subs.update({ userId, pausedAt: IsNull() }, { pausedAt: new Date() });
  }

  /** Removes the subscription only if it belongs to the user; its seen rows cascade (FK). */
  async remove(id: string, telegramUserId: number): Promise<boolean> {
    const owned = await this.subs.existsBy({ id, user: { telegramId: telegramUserId } });
    if (!owned) return false;
    await this.subs.delete({ id });
    return true;
  }

  /** Create the Telegram user, or refresh their profile — keyed by telegramId. */
  private async upsertUser(profile: TelegramUserProfile): Promise<User> {
    await this.users.upsert(profile, ['telegramId']);
    return this.users.findOneByOrFail({ telegramId: profile.telegramId });
  }

  // NOTE: "seen" = listing ids already delivered for a subscription; the diff skips them.
  // Query only the run's candidate ids, not the whole set — the table is window-pruned (3.4).
  async getSeen(subscriptionId: string, candidates: string[]): Promise<ReadonlySet<string>> {
    if (candidates.length === 0) return new Set();
    const rows = await this.seen.findBy({ subscriptionId, externalId: In(candidates) });
    if (rows.length > 0) {
      // NOTE: refresh seenAt for ids still in the page window, so the prune's "keep
      // newest N" tracks window membership — otherwise a listing bumped back into the
      // window could have its old seen row pruned and be re-delivered as "new".
      await this.seen.update(
        { subscriptionId, externalId: In(rows.map((r) => r.externalId)) },
        { seenAt: new Date() },
      );
    }
    return new Set(rows.map((r) => r.externalId));
  }

  /** Mark listings delivered so they aren't sent again; already-seen ids are ignored. */
  // NOTE: no explicit "subscription still exists" guard — the seen_listings FK
  // (ON DELETE CASCADE) already rules out orphan rows. A subscription removed mid-run
  // surfaces as a caught insert error in the caller, not a silent no-op.
  markSeen(subscriptionId: string, externalIds: string[]): Promise<void> {
    return this.insertSeen(this.seen.manager, subscriptionId, externalIds);
  }

  /**
   * Seed the seen set and flag the subscription baselined atomically — a crash must not
   * leave a half-seeded baseline marked done (it would then never re-seed).
   */
  async seedBaseline(subscriptionId: string, externalIds: string[]): Promise<void> {
    await this.subs.manager.transaction(async (manager) => {
      await this.insertSeen(manager, subscriptionId, externalIds);
      await manager.update(Subscription, { id: subscriptionId }, { baselinedAt: new Date() });
    });
  }

  // Insert-or-ignore on the composite PK (ON CONFLICT DO NOTHING) — safe to re-mark.
  private async insertSeen(
    manager: EntityManager,
    subscriptionId: string,
    externalIds: string[],
  ): Promise<void> {
    if (externalIds.length === 0) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(SeenListing)
      .values(externalIds.map((externalId) => ({ subscriptionId, externalId })))
      .orIgnore()
      .execute();
    await this.pruneSeen(manager, subscriptionId);
  }

  // Keep only the newest MAX_SEEN_PER_SUBSCRIPTION rows; drop the rest so the table
  // stays bounded. Raw SQL — TypeORM can't express "NOT IN (… ORDER BY … LIMIT …)".
  // NOTE: columns are quoted camelCase (default TypeORM naming), not snake_case.
  private async pruneSeen(manager: EntityManager, subscriptionId: string): Promise<void> {
    await manager.query(
      `DELETE FROM seen_listings
       WHERE "subscriptionId" = $1
         AND "externalId" NOT IN (
           SELECT "externalId" FROM seen_listings
           WHERE "subscriptionId" = $1
           ORDER BY "seenAt" DESC, "externalId" DESC
           LIMIT $2
         )`,
      [subscriptionId, MAX_SEEN_PER_SUBSCRIPTION],
    );
  }
}
