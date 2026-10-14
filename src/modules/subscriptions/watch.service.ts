import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

import { MAX_LISTINGS } from '@/modules/sources/source-adapter';
import type { FetchResult, Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from './entities/subscription.entity';
import { isEmpty } from './findings';
import type { Findings, Removal } from './findings';
import { hasPriceChanged, replacesSnapshot } from './price-change';
import type { PriceChange } from './price-change';
import {
  MAX_SEEN_PER_SUBSCRIPTION,
  SubscriptionsService,
  searchKey,
} from './subscriptions.service';

// A mass event: over half of the listings it could have hit, and at least a floor of them. A
// hundred prices changing at once is a parser fix or a site rewriting its prices (minor units,
// another field); half a sale list gone in a day is a layout change hiding cards — not sellers.
// Reported instead of a digest of false «💸»/«🚫» to every user. The removal floor is low: sale
// lists are short (ghb ~13 objects), and a false «sold» costs twice — the card returns as «new».
const MASS_PRICE_CHANGE_MIN = 10;
const MASS_REMOVAL_MIN = 3;

const isMass = (hits: number, of: number, floor: number): boolean => hits >= floor && hits * 2 > of;

/**
 * The fetches of one watch run, by search (searchKey): a search several users watch is fetched once
 * and its result handed to each — a protected source pays per page. A new map each run, so a page
 * is never older than the run. The promise is kept, so a failure is shared too: same page, same
 * failure. Always a full fetch (never `idsOnly`), so it serves a baseline and a check alike.
 */
export type SharedFetches = Map<string, Promise<FetchResult>>;

/** Result of one `poll` pass — what the caller should tell the user, if anything. */
export type PollOutcome =
  { kind: 'baselined'; count: number } | ({ kind: 'fresh' } & Findings) | { kind: 'nothing' };

/**
 * Diffs a subscription's source against what was already delivered. Callers drive
 * it via `poll` and call `markDelivered` only after a successful delivery, so a failed
 * send is retried next run (PRODUCT.md: persist only what was sent).
 */
@Injectable()
export class WatchService {
  private readonly logger = new Logger(WatchService.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly registry: SourceRegistry,
  ) {}

  /**
   * One polling pass. A subscription whose baseline failed earlier is seeded here
   * instead of flooding its whole backlog as "new". Findings are NOT recorded — the caller
   * delivers them and records only what was actually sent (markDelivered). `shared`: the watch
   * run's fetches, reused across the subscriptions of one search.
   */
  async poll(sub: Subscription, shared?: SharedFetches): Promise<PollOutcome> {
    // NOTE: both branches re-check `has` after the fetch — the user may remove the
    // subscription while it is in flight; a gone sub gets no report and no delivery
    // (its seen set is wiped, so everything would otherwise look fresh).
    if (!sub.baselinedAt) {
      const count = await this.baseline(sub, shared);
      return (await this.subscriptions.has(sub.id))
        ? { kind: 'baselined', count }
        : { kind: 'nothing' };
    }
    const found = await this.check(sub, shared);
    if (isEmpty(found) || !(await this.subscriptions.has(sub.id))) return { kind: 'nothing' };
    return { kind: 'fresh', ...found };
  }

  /**
   * Seed the seen set with current listings without notifying. Throws when the
   * fetch fails. Resolves to the number of listings seeded.
   */
  async baseline(sub: Subscription, shared?: SharedFetches): Promise<number> {
    // Ids are all a baseline needs — a source's item-page visits (gcn's prices) are skipped,
    // unless the run shares the fetch (a full one: see SharedFetches).
    const { listings } = await this.fetchListings(sub, { idsOnly: true, shared });
    // NOTE: seed + mark-baselined in one transaction (seedBaseline). A partial fetch is still
    // marked done, deliberately: leaving it pending would re-baseline every run, and a source
    // that always fails on page 2 would then never notify at all — silence is the worse of the
    // two failures. What the missed items cost is one burst of "new" later, bounded by the
    // digest cap; `complete` is reported so the cause is visible instead of guessed at.
    await this.subscriptions.seedBaseline(
      sub.id,
      listings.map((l) => l.externalId),
    );
    return listings.length;
  }

  /**
   * Fetch current listings: those not seen before, and seen ones whose price changed. Records
   * nothing undelivered — a change keeps its old snapshot until markDelivered, so an unsent one
   * comes back next run. Every other seen listing gets its snapshot replaced now (a seller's
   * edit or a parser fix must reach storage; sub-floor drift is absorbed run by run).
   */
  async check(sub: Subscription, shared?: SharedFetches): Promise<Findings> {
    const result = await this.fetchListings(sub, { shared });
    const { listings, capped } = result;
    const seen = await this.subscriptions.getSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
    const fresh: Listing[] = [];
    let priceChanges: PriceChange[] = [];
    const refreshed: Listing[] = [];
    let compared = 0;
    for (const listing of listings) {
      if (!seen.has(listing.externalId)) {
        fresh.push(listing);
        continue;
      }
      // No snapshot yet (a baseline row, a row from before snapshots): filled silently.
      // TODO [L]: one currency vanishing (BYN+USD → BYN) replaces the snapshot whole, so a later
      // USD return compares against nothing; merge the missing fields from `before` instead.
      const before = seen.get(listing.externalId);
      if (before) compared += 1;
      if (before && hasPriceChanged(before, listing)) priceChanges.push({ before, after: listing });
      else if (!before || replacesSnapshot(before, listing)) refreshed.push(listing);
    }
    if (isMass(priceChanges.length, compared, MASS_PRICE_CHANGE_MIN)) {
      this.warn(sub, `Mass price change for ${sub.source}: ${priceChanges.length} of ${compared}`);
      refreshed.push(...priceChanges.map((change) => change.after));
      priceChanges = [];
    }
    await this.subscriptions.updateSnapshots(sub.id, refreshed);
    // The whole window turned over since the last run: the source had more pages, and not one
    // listing in it was seen before — so whatever was published between it and the last
    // run's window was never fetched. Lost for good; this makes the loss visible (backlog,
    // «Больше 150 новых за сутки…»). A bumped old listing can mask it — fine for a cheap signal.
    // TODO [L]: a subscription removed mid-fetch has no seen rows left, so a capped walk warns for
    // a sub that is gone (`poll` re-checks `has` only after this). Rare; partial-fetch shares it.
    if (capped && fresh.length === listings.length) {
      this.warn(sub, `Page window overflowed for ${sub.source}`);
    }
    const removed = await this.findRemoved(sub, result, seen.size);
    return { listings: fresh, priceChanges, removed };
  }

  /**
   * Delivered listings gone from this fetch — sold, on a source that declares it (reportsRemoved).
   * Gone from the page means sold only when the page was read whole: an empty, partial or capped
   * fetch never removes (the prototype once «sold» 45 cars when Cloudflare returned 0). So a list
   * past the window (a complex over MAX_LISTINGS units) reports no removals, and neither does the
   * last unit of a sold-out list (its page comes back empty). A gone row stays until its removal
   * is delivered (markDelivered) — unless it has nothing to show.
   */
  private async findRemoved(
    sub: Subscription,
    { listings, complete, capped }: FetchResult,
    stillThere: number,
  ): Promise<Removal[]> {
    if (!this.adapter(sub).reportsRemoved || !complete || capped || listings.length === 0) {
      return [];
    }
    const gone = await this.subscriptions.findGone(
      sub.id,
      listings.map((l) => l.externalId),
    );
    // Rows kept, so this warns every run until the page is fixed or the rows age out — on purpose:
    // deleting them would bring the hidden listings back as «new» once the page shows them again.
    if (isMass(gone.length, stillThere + gone.length, MASS_REMOVAL_MIN)) {
      this.warn(
        sub,
        `Mass removal for ${sub.source}: ${gone.length} of ${stillThere + gone.length}`,
      );
      return [];
    }
    // No snapshot (a baseline row the first poll never filled): nothing to show — forgotten.
    await this.subscriptions.deleteSeen(
      sub.id,
      gone.filter((row) => !row.snapshot).map((row) => row.externalId),
    );
    return gone.flatMap(({ externalId, snapshot }) =>
      snapshot ? [{ externalId, last: snapshot }] : [],
    );
  }

  /** Current listings for a subscription, read-only (does not touch the seen set). */
  async current(sub: Subscription): Promise<Listing[]> {
    const { listings } = await this.fetchListings(sub);
    return listings;
  }

  /**
   * Record what reached the user so it is not sent again — call after a successful send: new
   * listings join the seen set, a delivered price change becomes the stored price, a delivered
   * removal is forgotten.
   *
   * Also stamps the user as just notified: every unsolicited delivery (the daily run and /check)
   * ends here, so this is the one writer the quiet report can count from. «Показать текущие»
   * does not come through here — the user asked for that look, it proves nothing about the bot.
   * NOTE: a failed stamp after the writes only brings the next quiet report forward — not worth
   * a transaction around what was already delivered.
   */
  async markDelivered(sub: Subscription, delivered: Findings): Promise<void> {
    // NOTE: nothing delivered → no stamp; the writes' own empty guards do not cover the stamp.
    if (isEmpty(delivered)) return;
    await this.subscriptions.markSeen(sub.id, delivered.listings);
    await this.subscriptions.updateSnapshots(
      sub.id,
      delivered.priceChanges.map((change) => change.after),
    );
    await this.subscriptions.deleteSeen(
      sub.id,
      delivered.removed.map((removal) => removal.externalId),
    );
    await this.subscriptions.markNotified(sub.userId);
  }

  /**
   * Fetch a subscription's current listings — the single door to a source, and so the only
   * place that can notice the window (MAX_LISTINGS) being outgrown. `paginate` enforces it, so
   * this is the backstop for an adapter that does not go through `paginate`. A search the run
   * already fetched is served from `shared` — and warned about once, by the fetch that made it.
   */
  private fetchListings(
    sub: Subscription,
    { idsOnly, shared }: { idsOnly?: boolean; shared?: SharedFetches } = {},
  ): Promise<FetchResult> {
    if (shared === undefined) return this.fetchFresh(sub, idsOnly);
    const key = searchKey(sub);
    let fetching = shared.get(key);
    if (fetching === undefined) {
      fetching = this.fetchFresh(sub, false);
      shared.set(key, fetching);
    }
    return fetching;
  }

  /** The source asked, with the fetch's own warnings. */
  private async fetchFresh(sub: Subscription, idsOnly?: boolean): Promise<FetchResult> {
    const result = await this.adapter(sub).fetch(sub.url, idsOnly ? { idsOnly } : undefined);
    const { listings } = result;
    // Reported here rather than in each caller: this is the one place every fetch passes
    // through, and all three of them are hurt by a prefix — a baseline under-counts the search,
    // a check leaves later-page ids un-refreshed and so prunable, and «показать текущие» shows
    // a partial list as the whole one. Page 1 still works and the run stays green, so without
    // this the breakage has no trace at all.
    if (!result.complete) this.warn(sub, `Partial fetch for ${sub.source}`);
    if (listings.length > MAX_LISTINGS) {
      this.logger.warn(
        `${sub.source} returned ${listings.length} listings for one search — over the ` +
          `${MAX_LISTINGS} window MAX_SEEN_PER_SUBSCRIPTION (${MAX_SEEN_PER_SUBSCRIPTION}) is ` +
          `sized for. Bound the adapter by it, or pruned listings start coming back as new.`,
      );
    }
    return result;
  }

  /** A per-subscription anomaly the run survives: logged, and a Sentry warning with its context. */
  private warn(sub: Subscription, message: string): void {
    this.logger.warn(`${message}: ${sub.url}`);
    Sentry.withScope((scope) => {
      scope.setContext('subscription', { id: sub.id, source: sub.source, url: sub.url });
      Sentry.captureMessage(message, 'warning');
    });
  }

  private adapter(sub: Subscription): SourceAdapter {
    const adapter = this.registry.get(sub.source);
    // Subscriptions exist only for registry-matched URLs — a miss is a wiring bug;
    // fail loudly instead of faking an empty result.
    if (!adapter) throw new Error(`No source adapter registered for '${sub.source}'`);
    return adapter;
  }
}
