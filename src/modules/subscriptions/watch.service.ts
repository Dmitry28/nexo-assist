import { Injectable } from '@nestjs/common';

import type { KufarListing } from '@/modules/kufar/entities/kufar-listing.entity';
import { KufarService } from '@/modules/kufar/kufar.service';

import type { SourceId, Subscription } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Diffs a subscription's source against what was already delivered.
 * `baseline` seeds the seen set silently; `check` returns only fresh listings.
 */
@Injectable()
export class WatchService {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly kufar: KufarService,
  ) {}

  /** Seed the seen set with current listings without notifying. */
  async baseline(sub: Subscription): Promise<{ supported: boolean; count: number }> {
    if (!this.isSupported(sub.source)) return { supported: false, count: 0 };
    const listings = await this.fetch(sub);
    this.subscriptions.markSeen(
      sub.id,
      listings.map((l) => l.adId),
    );
    return { supported: true, count: listings.length };
  }

  /** Fetch current listings and return only those not seen before, marking them seen. */
  async check(sub: Subscription): Promise<KufarListing[]> {
    if (!this.isSupported(sub.source)) return [];
    const listings = await this.fetch(sub);
    const seen = this.subscriptions.getSeen(sub.id);
    const fresh = listings.filter((l) => !seen.has(l.adId));
    this.subscriptions.markSeen(
      sub.id,
      fresh.map((l) => l.adId),
    );
    return fresh;
  }

  // NOTE: only kufar has a fetcher today; realt gains one in a later step.
  private isSupported(source: SourceId): boolean {
    return source === 'kufar';
  }

  private fetch(sub: Subscription): Promise<KufarListing[]> {
    return this.kufar.fetch(sub.url);
  }
}
