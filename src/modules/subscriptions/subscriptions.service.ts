import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { SourceId, Subscription } from './entities/subscription.entity';

/**
 * Reference store backed by an in-memory Map.
 * Swap for a repository when the DB lands — callers stay unchanged.
 */
@Injectable()
export class SubscriptionsService {
  private readonly store = new Map<string, Subscription>();

  add(input: { telegramUserId: number; source: SourceId; url: string }): Subscription {
    const subscription: Subscription = { id: randomUUID(), createdAt: new Date(), ...input };
    this.store.set(subscription.id, subscription);
    return subscription;
  }

  listByUser(telegramUserId: number): Subscription[] {
    return [...this.store.values()].filter((s) => s.telegramUserId === telegramUserId);
  }

  /** Removes the subscription only if it belongs to the user. Returns whether it existed. */
  remove(id: string, telegramUserId: number): boolean {
    const subscription = this.store.get(id);
    if (!subscription || subscription.telegramUserId !== telegramUserId) return false;
    return this.store.delete(id);
  }
}
