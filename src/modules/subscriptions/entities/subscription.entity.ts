import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { SourceId } from '@/modules/sources/source-adapter';

/** A user's request to watch one search URL. */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NOTE: bigint column — Telegram ids exceed int4; they still fit JS's safe-integer
  // range, so the transformer keeps the field a plain number across the app.
  @Column({
    type: 'bigint',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  telegramUserId: number;

  @Column({ type: 'varchar' })
  source: SourceId;

  @Column({ type: 'text' })
  url: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** When the seen set was seeded. Unset = baseline still pending (e.g. it failed on subscribe). */
  @Column({ type: 'timestamptz', nullable: true })
  baselinedAt?: Date;
}
