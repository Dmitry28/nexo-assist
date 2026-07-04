import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { SourceId } from '@/modules/sources/source-adapter';

import { SeenListing } from './entities/seen-listing.entity';
import { Subscription } from './entities/subscription.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(SeenListing) private readonly seen: Repository<SeenListing>,
  ) {}

  add(input: { telegramUserId: number; source: SourceId; url: string }): Promise<Subscription> {
    return this.subs.save(this.subs.create(input));
  }

  has(id: string): Promise<boolean> {
    return this.subs.existsBy({ id });
  }

  listByUser(telegramUserId: number): Promise<Subscription[]> {
    return this.subs.findBy({ telegramUserId });
  }

  listAll(): Promise<Subscription[]> {
    return this.subs.find();
  }

  /** Removes the subscription only if it belongs to the user; its seen rows cascade (FK). */
  async remove(id: string, telegramUserId: number): Promise<boolean> {
    const { affected } = await this.subs.delete({ id, telegramUserId });
    return (affected ?? 0) > 0;
  }

  // NOTE: "seen" = listing ids already delivered for a subscription; the diff skips them.
  // Query only the run's candidate ids, not the whole set — the table is window-pruned (3.4).
  async getSeen(subscriptionId: string, candidates: string[]): Promise<ReadonlySet<string>> {
    if (candidates.length === 0) return new Set();
    const rows = await this.seen.findBy({ subscriptionId, externalId: In(candidates) });
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
  }
}
