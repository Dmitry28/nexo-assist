import { Injectable } from '@nestjs/common';

import type { Listing } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Diffs a subscription's source against what was already delivered.
 * `baseline` seeds the seen set silently; `check` returns fresh listings without
 * marking them — the caller calls `markSeen` only after a successful delivery,
 * so a failed send is retried next run (PRODUCT.md: persist only what was sent).
 */
@Injectable()
export class WatchService {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly registry: SourceRegistry,
  ) {}

  /** Seed the seen set with current listings without notifying. Throws when the fetch fails. */
  async baseline(sub: Subscription): Promise<{ supported: boolean; count: number }> {
    const adapter = this.registry.get(sub.source);
    if (!adapter) return { supported: false, count: 0 };
    const listings = await adapter.fetch(sub.url);
    this.markSeen(sub, listings);
    // NOTE: a later-page fetch failure yields a partial list (paginate keeps what it collected),
    // so a partial baseline is still marked done — missed items surface as "new" later, bounded
    // by the digest cap. Accepted until fetch reports completeness.
    this.subscriptions.markBaselined(sub.id);
    return { supported: true, count: listings.length };
  }

  /** Fetch current listings and return those not seen before. Read-only. */
  async check(sub: Subscription): Promise<Listing[]> {
    const adapter = this.registry.get(sub.source);
    if (!adapter) return [];
    const listings = await adapter.fetch(sub.url);
    const seen = this.subscriptions.getSeen(sub.id);
    return listings.filter((l) => !seen.has(l.externalId));
  }

  /** Current listings for a subscription, read-only (does not touch the seen set). */
  current(sub: Subscription): Promise<Listing[]> {
    return this.registry.get(sub.source)?.fetch(sub.url) ?? Promise.resolve([]);
  }

  /** Mark listings as delivered so they are not sent again — call after a successful send. */
  markSeen(sub: Subscription, listings: Listing[]): void {
    this.subscriptions.markSeen(
      sub.id,
      listings.map((l) => l.externalId),
    );
  }
}
