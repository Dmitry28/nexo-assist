import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Who asked for a site we did not support — kept here, never in the public issue, so they can be
 * told once a parser for it ships. One row per user and site (their latest link); the row is
 * deleted once they are told, or REQUEST_KEPT_DAYS after their latest ask.
 * NOTE: no foreign key to `users` (a requester may never have subscribed) — deleting a user's data
 * by hand (/help) must clear this table by `telegramId` too.
 */
@Entity('source_requests')
@Unique(['telegramId', 'host'])
export class SourceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NOTE: bigint (Telegram ids exceed int4) transformed to number — see User.
  @Column({
    type: 'bigint',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  telegramId: number;

  /** requestHost — the site, `www.` dropped. */
  @Column({ type: 'varchar' })
  host: string;

  @Column({ type: 'text' })
  url: string;

  // NOTE: refreshed on every ask (the upsert sets it), so it is the latest ask, not a creation
  // time — `expire` counts from it.
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
