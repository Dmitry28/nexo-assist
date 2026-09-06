import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import type { SourceId } from '@/modules/sources/source-adapter';

import { User } from './user.entity';

/** A user's request to watch one search URL. */
@Entity('subscriptions')
@Unique(['userId', 'normalizedUrl'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  // NOTE: eager — the scheduler needs user.telegramId to deliver without a second query.
  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar' })
  source: SourceId;

  @Column({ type: 'text' })
  url: string;

  // Canonical form of `url` for dedup — unique per user (see @Unique above).
  @Column({ type: 'text' })
  normalizedUrl: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** When the seen set was seeded. Unset = baseline still pending (e.g. it failed on subscribe). */
  @Column({ type: 'timestamptz', nullable: true })
  baselinedAt?: Date;

  /** When the subscription was paused. null = active; set = skipped by the scheduler
   * (e.g. auto-paused after the user blocked the bot). Cleared when the user re-adds it. */
  @Column({ type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  /** Consecutive failed polls (errors only). Reset on any successful poll; at the cap
   * the subscription is auto-paused and the user is asked to refresh the link. */
  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;
}
