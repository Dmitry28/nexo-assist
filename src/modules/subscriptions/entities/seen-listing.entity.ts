import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

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

  @CreateDateColumn({ type: 'timestamptz' })
  seenAt: Date;

  // NOTE: FK only for the cascade — deleting a subscription drops its seen rows.
  // Reuses the subscriptionId PK column (no separate FK column).
  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription: Subscription;
}
