import { Injectable } from '@nestjs/common';

import type { Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

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
    const listings = await this.adapter(sub).fetch(sub.url);
    // NOTE: seed + mark-baselined in one transaction (seedBaseline). A later-page fetch
    // failure yields a partial list (paginate keeps what it collected), so a partial
    // baseline is still marked done — missed items surface as "new" later, bounded by the
    // digest cap. Accepted until fetch reports completeness.
    await this.subscriptions.seedBaseline(
      sub.id,
      listings.map((l) => l.externalId),
    );
    return listings.length;
  }

  /** Fetch current listings and return those not seen before. Read-only. */
  async check(sub: Subscription): Promise<Listing[]> {
    const listings = await this.adapter(sub).fetch(sub.url);
    const seen = await this.subscriptions.getSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
    return listings.filter((l) => !seen.has(l.externalId));
  }

  /** Current listings for a subscription, read-only (does not touch the seen set). */
  current(sub: Subscription): Promise<Listing[]> {
    return this.adapter(sub).fetch(sub.url);
  }

  /** Mark listings as delivered so they are not sent again — call after a successful send. */
  markSeen(sub: Subscription, listings: Listing[]): Promise<void> {
    return this.subscriptions.markSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
  }

  private adapter(sub: Subscription): SourceAdapter {
    const adapter = this.registry.get(sub.source);
    // Subscriptions exist only for registry-matched URLs — a miss is a wiring bug;
    // fail loudly instead of faking an empty result.
    if (!adapter) throw new Error(`No source adapter registered for '${sub.source}'`);
    return adapter;
  }
}
