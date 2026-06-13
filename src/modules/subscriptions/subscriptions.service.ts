import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { SourceId } from '@/modules/sources/source-adapter';

import type { Subscription } from './entities/subscription.entity';

// NOTE: Phase 1 — everything is in-memory and unbounded; the DB slice replaces this store.
@Injectable()
export class SubscriptionsService {
  private readonly store = new Map<string, Subscription>();
  // Listing ids already delivered per subscription — the "seen" level of the diff.
  private readonly seen = new Map<string, Set<string>>();

  add(input: { telegramUserId: number; source: SourceId; url: string }): Subscription {
    const subscription: Subscription = { id: randomUUID(), createdAt: new Date(), ...input };
    this.store.set(subscription.id, subscription);
    return subscription;
  }

  listByUser(telegramUserId: number): Subscription[] {
    return [...this.store.values()].filter((s) => s.telegramUserId === telegramUserId);
  }

  listAll(): Subscription[] {
    return [...this.store.values()];
  }

  /** Removes the subscription only if it belongs to the user. Returns whether it existed. */
  remove(id: string, telegramUserId: number): boolean {
    const subscription = this.store.get(id);
    if (!subscription || subscription.telegramUserId !== telegramUserId) return false;
    this.seen.delete(id);
    return this.store.delete(id);
  }

  // NOTE: "seen" = listing ids already delivered for a subscription; the diff skips them.
  getSeen(subscriptionId: string): ReadonlySet<string> {
    return this.seen.get(subscriptionId) ?? new Set<string>();
  }

  markSeen(subscriptionId: string, externalIds: string[]): void {
    const set = this.seen.get(subscriptionId) ?? new Set<string>();
    for (const id of externalIds) set.add(id);
    this.seen.set(subscriptionId, set);
  }
}
