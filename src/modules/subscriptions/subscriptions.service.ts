import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { normalizeUrl } from '@/common/url';
import type { CreditPool, Listing, SourceId } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import { SeenListing } from './entities/seen-listing.entity';
import { Subscription } from './entities/subscription.entity';
import { User } from './entities/user.entity';
import { asSnapshot, toSnapshot } from './price-change';
import type { ListingSnapshot } from './price-change';

// Cap on stored seen rows per subscription. Kept well above the window one fetch can return
// (MAX_LISTINGS, sources/source-adapter.ts) so ids still reachable are never pruned.
// NOTE: "fell out of the window" is not "gone for good" — kufar sorts by list_time, which a
// seller's bump moves, so a listing bumped back after its row was pruned arrives as "new"
// again. Accepted for now; see the «Технический бэклог» in docs/PRODUCT_PLAN.md.
export const MAX_SEEN_PER_SUBSCRIPTION = 1000;

// Anti-abuse: cap subscriptions per user (also keeps /list within Telegram's limits).
export const MAX_SUBSCRIPTIONS_PER_USER = 50;

// Paid credits a day the searches watched on protected sources may cost, per pool — each search
// once, whoever watches it (a run fetches it once: WatchService), at its worst
// (SourceAdapter.paidPoll), assuming one run a day (WATCH_CRON's default). Each pool is its first
// paying providers' free tiers a month: geo — ZenRows + Scrape.do, 6000 / 30; global — ScrapingAnt,
// 10000 less ~1000 kept for baselines and /check, / 30 — Copart's window and bid.cars's fallback cost
// 6 a poll (1 a page, measured), so ~50 searches. One rule for everyone (owner, 2026-10-13);
// the arithmetic — PRODUCT_PLAN.md § «Платная ступень».
// TODO [M]: baselines and /check poll on top of the daily run and are not counted — the tiers
// outside the sum (ScrapeOps and ScrapFly for geo, ScraperAPI and the ~1000 for global) are their
// margin. Onboarding a company spends a page per subscribe even on a search already watched; past
// ~100 subscribes a month the global pool runs dry before the month ends. Seed such a baseline
// from the run's next fetch instead (PRODUCT_PLAN.md «bid.cars бесплатно и массово»).
export const DAILY_CREDIT_BUDGET: Readonly<Record<CreditPool, number>> = { geo: 200, global: 300 };

/** One search on one source — what a watch run fetches once, however many users watch it. */
export const searchKey = ({
  source,
  normalizedUrl,
}: Pick<Subscription, 'source' | 'normalizedUrl'>) => `${source} ${normalizedUrl}`;

/** The user already watches this search (matched by normalized URL). */
export class DuplicateSubscriptionError extends Error {}
/** The user hit MAX_SUBSCRIPTIONS_PER_USER. */
export class SubscriptionLimitError extends Error {}
/** The subscription would take the bot past DAILY_CREDIT_BUDGET. */
export class ProtectedLimitError extends Error {}

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
    private readonly sources: SourceRegistry,
  ) {}

  async add(input: {
    user: TelegramUserProfile;
    source: SourceId;
    url: string;
  }): Promise<Subscription> {
    // Each source drops only its own sort/paging/noise keys — on another site the same key may be
    // a filter. Looked up by the id the subscription is stored with, before any write.
    const adapter = this.sources.get(input.source);
    if (!adapter) throw new Error(`Invariant: no registered adapter for source ${input.source}`);
    const user = await this.upsertUser(input.user);
    // Dedup on the normalized URL (a unique index backs it); the bot flow is sequential,
    // so the check-then-insert TOCTOU race is negligible.
    const normalizedUrl = normalizeUrl(input.url, adapter.volatileParams);
    const existing = await this.subs.findOneBy({ userId: user.id, normalizedUrl });
    // Re-sending a URL you already watch revives it if it was auto-paused (dead link /
    // blocked); an active one is a real duplicate.
    if (existing && !existing.pausedAt) throw new DuplicateSubscriptionError();

    // A revive reactivates a paused sub, so it's capped the same as a fresh add.
    await this.assertUnderActiveCap(user.id, { source: input.source, normalizedUrl });
    if (existing) return this.revive(existing); // paused (checked above) → reactivate
    let created: Subscription;
    try {
      created = await this.subs.save(
        this.subs.create({ userId: user.id, source: input.source, url: input.url, normalizedUrl }),
      );
    } catch (err) {
      // The unique index is the real guard — map a race that beat the findOneBy check.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new DuplicateSubscriptionError();
      }
      throw err;
    }
    return this.reload(created.id);
  }

  has(id: string): Promise<boolean> {
    return this.subs.existsBy({ id });
  }

  /**
   * The user's own subscription, or null when it is not theirs or is gone. Every id that
   * reaches us in `callback_data` is user-controlled, so this scoped lookup — not a lookup
   * by id — is the ownership boundary for all of them.
   */
  findOwned(id: string, telegramUserId: number): Promise<Subscription | null> {
    return this.subs.findOneBy({ id, user: { telegramId: telegramUserId } });
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

  /** Count of active (non-paused) subscriptions — for metrics / admin stats. */
  countActive(): Promise<number> {
    return this.subs.countBy({ pausedAt: IsNull() });
  }

  /** Count of paused subscriptions — for admin stats. */
  countPaused(): Promise<number> {
    return this.subs.countBy({ pausedAt: Not(IsNull()) });
  }

  /** Count of users — for metrics / admin stats. */
  countUsers(): Promise<number> {
    return this.users.count();
  }

  /**
   * Pause every currently-active subscription of a user — used after a Telegram 403
   * (the user blocked the bot), so we stop scraping/delivering for them. Only touches
   * active rows, so an existing pause timestamp is preserved.
   */
  async pauseAllForUser(userId: string): Promise<number> {
    const result = await this.subs.update({ userId, pausedAt: IsNull() }, { pausedAt: new Date() });
    return result.affected ?? 0;
  }

  /**
   * Pause a single subscription — used when its URL looks dead (see consecutiveFailures).
   * Touches an active row only, exactly like pauseAllForUser: pausing twice must not move the
   * timestamp of the first pause (the 403 path may have paused this row earlier in the same run).
   */
  async pause(id: string): Promise<void> {
    await this.subs.update({ id, pausedAt: IsNull() }, { pausedAt: new Date() });
  }

  /**
   * Throw once the user is at the active-subscription cap, or — for a new search on a protected
   * source — the bot would go past its pool's daily credit budget. A search someone already
   * watches is free: the run fetches it once. Counts active only — auto-paused subs create no
   * scraping load, so they must not lock anyone out.
   */
  private async assertUnderActiveCap(
    userId: Subscription['userId'],
    search: Pick<Subscription, 'source' | 'normalizedUrl'>,
  ): Promise<void> {
    const activeCount = await this.subs.countBy({ userId, pausedAt: IsNull() });
    if (activeCount >= MAX_SUBSCRIPTIONS_PER_USER) throw new SubscriptionLimitError();
    const paid = (id: SourceId) => this.sources.get(id)?.paidPoll;
    const poll = paid(search.source);
    if (poll === undefined) return;
    // NOTE: count-then-insert, so two adds at once can overshoot by one — the bot handles updates
    // one by one, and one extra poll costs a few days of credits, not an outage.
    const active = await this.subs.find({
      select: { source: true, normalizedUrl: true },
      where: { source: In(this.sources.paidIds()), pausedAt: IsNull() },
    });
    const watched = new Map(active.map((sub) => [searchKey(sub), sub.source]));
    if (watched.has(searchKey(search))) return;
    const spent = [...watched.values()]
      .map(paid)
      .reduce((sum, other) => sum + (other?.pool === poll.pool ? other.credits : 0), 0);
    if (spent + poll.credits > DAILY_CREDIT_BUDGET[poll.pool]) throw new ProtectedLimitError();
  }

  /** Re-activate a paused subscription (user re-sent its URL): clear pause + failure streak. */
  private async revive(sub: Subscription): Promise<Subscription> {
    await this.subs.update({ id: sub.id }, { pausedAt: null, consecutiveFailures: 0 });
    return this.reload(sub.id);
  }

  /**
   * Re-read a row after a write — every Subscription this service returns comes through here.
   * Neither `save` nor `update` populates the eager `user` relation, so returning their result
   * would hand back a `user` of undefined while the type promises otherwise.
   */
  private reload(id: string): Promise<Subscription> {
    return this.subs.findOneByOrFail({ id });
  }

  /**
   * Un-pause the user's subscription — the /list ▶️ button. NOT the same as re-sending its URL:
   * this leaves the seen set alone, so the pause backlog still gets delivered, while re-sending
   * goes through the subscribe handler and re-baselines, dropping it (see PRODUCT.md § Status now).
   * False when it isn't theirs or is gone; throws SubscriptionLimitError or ProtectedLimitError at a cap.
   */
  async resume(id: string, telegramUserId: number): Promise<boolean> {
    const sub = await this.findOwned(id, telegramUserId);
    if (!sub) return false;
    if (!sub.pausedAt) return true; // already active — nothing to do
    await this.assertUnderActiveCap(sub.userId, sub);
    await this.revive(sub);
    return true;
  }

  /** Increment a subscription's consecutive-failure streak by one (atomic). */
  async bumpFailures(id: string): Promise<void> {
    await this.subs.increment({ id }, 'consecutiveFailures', 1);
  }

  /** Clear the failure streak after a successful poll. */
  async resetFailures(id: string): Promise<void> {
    await this.subs.update({ id }, { consecutiveFailures: 0 });
  }

  /** Set (or with null, clear) the user's keyword filter on their subscription. False if not theirs. */
  async setKeywords(id: string, telegramUserId: number, keywords: string | null): Promise<boolean> {
    if (!(await this.findOwned(id, telegramUserId))) return false;
    await this.subs.update({ id }, { keywords });
    return true;
  }

  /** Removes the subscription only if it belongs to the user; its seen rows cascade (FK). */
  async remove(id: string, telegramUserId: number): Promise<boolean> {
    if (!(await this.findOwned(id, telegramUserId))) return false;
    await this.subs.delete({ id });
    return true;
  }

  /** Create the Telegram user, or refresh their profile — keyed by telegramId. */
  private async upsertUser(profile: TelegramUserProfile): Promise<User> {
    // Absent → null, not left out: an upsert skips undefined columns, so a @username the user
    // dropped would otherwise be kept forever.
    const { username = null, firstName = null, lastName = null, language = null } = profile;
    await this.users.upsert(
      { telegramId: profile.telegramId, username, firstName, lastName, language },
      ['telegramId'],
    );
    return this.users.findOneByOrFail({ telegramId: profile.telegramId });
  }

  /**
   * Which of this run's candidate ids were already delivered ("seen" — the diff skips them), each
   * with its stored snapshot (undefined when the row has none yet). Only the candidates are
   * queried, never the whole set: the table is window-pruned (3.4).
   *
   * NOTE: writes, despite the name — it also refreshes `seenAt` on the rows it found, which keeps
   * the prune's "keep the newest N" aligned with the page window — without it a listing bumped
   * back into the window could lose its seen row and be re-delivered as "new". One call, because
   * both halves must cover exactly the same ids.
   */
  async getSeen(
    subscriptionId: string,
    candidates: string[],
  ): Promise<ReadonlyMap<string, ListingSnapshot | undefined>> {
    if (candidates.length === 0) return new Map();
    const rows = await this.seen.findBy({ subscriptionId, externalId: In(candidates) });
    if (rows.length > 0) {
      await this.seen.update(
        { subscriptionId, externalId: In(rows.map((r) => r.externalId)) },
        { seenAt: new Date() },
      );
    }
    return new Map(rows.map((r) => [r.externalId, asSnapshot(r.snapshot)]));
  }

  /**
   * Replace the stored snapshots of already-seen listings with what the site shows now — one
   * statement for the whole run. An UPDATE, never an upsert: a row gone (subscription removed
   * mid-run, pruned) stays gone. Unchanged snapshots are not rewritten.
   */
  async updateSnapshots(subscriptionId: string, listings: Listing[]): Promise<void> {
    if (listings.length === 0) return;
    const rows = listings.map((l) => ({ externalId: l.externalId, snapshot: toSnapshot(l) }));
    // Raw SQL: TypeORM has no bulk UPDATE with a value per row (camelCase columns, as pruneSeen).
    await this.seen.query(
      `UPDATE seen_listings s SET snapshot = v.snapshot
       FROM jsonb_to_recordset($2::jsonb) AS v("externalId" varchar, snapshot jsonb)
       WHERE s."subscriptionId" = $1
         AND s."externalId" = v."externalId"
         AND s.snapshot IS DISTINCT FROM v.snapshot`,
      [subscriptionId, JSON.stringify(rows)],
    );
  }

  /**
   * The subscription's stored rows missing from this run — the removal candidates. Read-only: the
   * caller decides whether a fetch was complete enough to call them gone. Nothing present → every
   * row (a watched listing the site called gone), without leaning on how `In([])` renders.
   */
  async findGone(
    subscriptionId: string,
    present: string[],
  ): Promise<{ externalId: string; snapshot: ListingSnapshot | undefined }[]> {
    const rows = await this.seen.findBy(
      present.length === 0 ? { subscriptionId } : { subscriptionId, externalId: Not(In(present)) },
    );
    return rows.map((r) => ({ externalId: r.externalId, snapshot: asSnapshot(r.snapshot) }));
  }

  /** Forget listings — sold ones, delivered as such; one that comes back arrives as new. */
  async deleteSeen(subscriptionId: string, externalIds: string[]): Promise<void> {
    if (externalIds.length === 0) return;
    await this.seen.delete({ subscriptionId, externalId: In(externalIds) });
  }

  /** Mark listings delivered so they aren't sent again; already-seen ids are ignored. */
  // NOTE: no explicit "subscription still exists" guard — the seen_listings FK
  // (ON DELETE CASCADE) already rules out orphan rows. A subscription removed mid-run
  // surfaces as a caught insert error in the caller, not a silent no-op.
  markSeen(subscriptionId: string, listings: Listing[]): Promise<void> {
    return this.insertSeen({
      manager: this.seen.manager,
      subscriptionId,
      rows: listings.map((l) => ({ externalId: l.externalId, snapshot: toSnapshot(l) })),
    });
  }

  /** Stamp that the user was just sent something — what the quiet report counts from. */
  async markNotified(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastNotifiedAt: new Date() });
  }

  /**
   * Seed the seen set and flag the subscription baselined atomically — a crash must not
   * leave a half-seeded baseline marked done (it would then never re-seed).
   * No snapshots: a baseline may skip item pages, so its prices would be partial — the first
   * poll fills them silently.
   */
  async seedBaseline(subscriptionId: string, externalIds: string[]): Promise<void> {
    await this.subs.manager.transaction(async (manager) => {
      const rows = externalIds.map((externalId) => ({ externalId, snapshot: null }));
      await this.insertSeen({ manager, subscriptionId, rows });
      await manager.update(Subscription, { id: subscriptionId }, { baselinedAt: new Date() });
    });
  }

  /**
   * Seed the listings past a widened window as seen, silently (WatchService.check) — and, once the
   * fetch was `complete`, forget the old window size so the next run judges the whole window.
   */
  async seedPastWindow(
    subscriptionId: string,
    listings: Listing[],
    complete: boolean,
  ): Promise<void> {
    await this.subs.manager.transaction(async (manager) => {
      const rows = listings.map((l) => ({ externalId: l.externalId, snapshot: toSnapshot(l) }));
      await this.insertSeen({ manager, subscriptionId, rows });
      if (complete)
        await manager.update(Subscription, { id: subscriptionId }, { widenedFrom: null });
    });
  }

  // Insert-or-ignore on the composite PK (ON CONFLICT DO NOTHING) — safe to re-mark.
  private async insertSeen({
    manager,
    subscriptionId,
    rows,
  }: {
    manager: EntityManager;
    subscriptionId: Subscription['id'];
    rows: Pick<SeenListing, 'externalId' | 'snapshot'>[];
  }): Promise<void> {
    if (rows.length === 0) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(SeenListing)
      .values(rows.map((row) => ({ subscriptionId, ...row })))
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
