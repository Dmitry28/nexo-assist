import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A Telegram account. Profile fields are captured on first interaction (ctx.from). */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NOTE: bigint (Telegram ids exceed int4) transformed to number — see Subscription.
  @Column({
    type: 'bigint',
    unique: true,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  telegramId: number;

  // `| null`, not `?`: Telegram omits these, but Postgres hands back null — `?` would promise
  // undefined and quietly diverge from what a loaded row actually holds.
  @Column({ type: 'varchar', nullable: true })
  username: string | null;

  @Column({ type: 'varchar', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', nullable: true })
  language: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
