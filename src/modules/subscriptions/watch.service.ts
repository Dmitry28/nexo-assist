import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

import type { FetchResult, Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from './entities/subscription.entity';
import { MAX_SEEN_PER_SUBSCRIPTION, SubscriptionsService } from './subscriptions.service';

/** Result of one `poll` pass — what the caller should tell the user, if anything. */
export type PollOutcome =
  | { kind: 'baselined'; count: number }
  | { kind: 'fresh'; listings: Listing[] }
  | { kind: 'nothing' };

/**
 * Diffs a subscription's source against what was already delivered. Callers drive
 * it via `poll` and call `markSeen` only after a successful delivery, so a failed
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
   * instead of flooding its whole backlog as "new". Fresh listings are NOT marked
   * seen — the caller delivers them and marks only what was actually sent.
   */
  async poll(sub: Subscription): Promise<PollOutcome> {
    // NOTE: both branches re-check `has` after the fetch — the user may remove the
    // subscription while it is in flight; a gone sub gets no report and no delivery
    // (its seen set is wiped, so everything would otherwise look fresh).
    if (!sub.baselinedAt) {
      const count = await this.baseline(sub);
      return (await this.subscriptions.has(sub.id))
        ? { kind: 'baselined', count }
        : { kind: 'nothing' };
    }
    const fresh = await this.check(sub);
    if (fresh.length === 0 || !(await this.subscriptions.has(sub.id))) return { kind: 'nothing' };
    return { kind: 'fresh', listings: fresh };
  }

  /**
   * Seed the seen set with current listings without notifying. Throws when the
   * fetch fails. Resolves to the number of listings seeded.
   */
  async baseline(sub: Subscription): Promise<number> {
    const { listings } = await this.fetchListings(sub);
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
   * Fetch current listings and return those not seen before. Marks nothing seen
   * (getSeen only refreshes `seenAt` on already-delivered ids for the prune window).
   */
  async check(sub: Subscription): Promise<Listing[]> {
    const { listings } = await this.fetchListings(sub);
    const seen = await this.subscriptions.getSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
    return listings.filter((l) => !seen.has(l.externalId));
  }

  /** Current listings for a subscription, read-only (does not touch the seen set). */
  async current(sub: Subscription): Promise<Listing[]> {
    const { listings } = await this.fetchListings(sub);
    return listings;
  }

  /** Mark listings as delivered so they are not sent again — call after a successful send. */
  markSeen(sub: Subscription, listings: Listing[]): Promise<void> {
    return this.subscriptions.markSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
  }

  /**
   * Fetch a subscription's current listings — the single door to a source, and so the only
   * place that can notice the seen-set cap being outgrown. That cap is safe only while one
   * fetch returns fewer ids than it stores (page window ≈ 150 against 300). An adapter with
   * bigger pages breaks it silently: ids still on the page get pruned and re-delivered as
   * "new" every run. Warn at half the cap — exactly where the assumption sits today.
   */
  private async fetchListings(sub: Subscription): Promise<FetchResult> {
    const result = await this.adapter(sub).fetch(sub.url);
    const { listings } = result;
    // Reported here rather than in each caller: this is the one place every fetch passes
    // through, and all three of them are hurt by a prefix — a baseline under-counts the search,
    // a check leaves later-page ids un-refreshed and so prunable, and «показать текущие» shows
    // a partial list as the whole one. Page 1 still works and the run stays green, so without
    // this the breakage has no trace at all.
    if (!result.complete) {
      this.logger.warn(`${sub.source}: a later page failed for ${sub.url} — listings are partial`);
      Sentry.withScope((scope) => {
        scope.setContext('subscription', { id: sub.id, source: sub.source, url: sub.url });
        Sentry.captureMessage(`Partial fetch for ${sub.source}`, 'warning');
      });
    }
    if (listings.length > MAX_SEEN_PER_SUBSCRIPTION / 2) {
      this.logger.warn(
        `${sub.source} returned ${listings.length} listings for one search — over half of ` +
          `MAX_SEEN_PER_SUBSCRIPTION (${MAX_SEEN_PER_SUBSCRIPTION}). Raise the cap before the ` +
          `page window reaches it, or pruned listings start coming back as new.`,
      );
    }
    return result;
  }

  private adapter(sub: Subscription): SourceAdapter {
    const adapter = this.registry.get(sub.source);
    // Subscriptions exist only for registry-matched URLs — a miss is a wiring bug;
    // fail loudly instead of faking an empty result.
    if (!adapter) throw new Error(`No source adapter registered for '${sub.source}'`);
    return adapter;
  }
}
