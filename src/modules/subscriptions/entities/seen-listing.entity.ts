import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Subscription } from './subscription.entity';

/**
 * A listing id already delivered for a subscription — the persistent "seen" set.
 * Composite PK `(subscriptionId, externalId)` is also the lookup index for the
 * "have we seen these ids?" check.
 */
@Entity('seen_listings')
export class SeenListing {
  @PrimaryColumn('uuid')
  subscriptionId: string;

  @PrimaryColumn({ type: 'varchar' })
  externalId: string;

  /**
   * Last time this listing was seen inside the source's page window — refreshed on every poll
   * that still finds it (SubscriptionsService.getSeen), because the prune keeps the newest N.
   * Hence a plain column with a DB default, not @CreateDateColumn: it is not a creation
   * timestamp, and declaring it as one invites an ORM that refuses to update it.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  seenAt: Date;

  // NOTE: FK only for the cascade — deleting a subscription drops its seen rows.
  // Reuses the subscriptionId PK column (no separate FK column).
  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription: Subscription;
}
