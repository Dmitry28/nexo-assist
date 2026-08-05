import type { MigrationInterface, QueryRunner } from 'typeorm';

// Every table lives in the `public` schema, which managed providers (Supabase) also expose over
// a public HTTP API. Row-Level Security with NO policies denies that path entirely, while the
// table owner — the role our app and migrations connect as — bypasses RLS, so nothing changes
// for us. Defense in depth: the HTTP API is switched off at the provider too.
// NOTE: hand-written on purpose. RLS is not part of the entity metadata, so `migration:generate`
// cannot produce it and will not report its absence as drift.
const TABLES = ['users', 'subscriptions', 'seen_listings', 'migrations'];

export class EnableRowLevelSecurity1785920305000 implements MigrationInterface {
  name = 'EnableRowLevelSecurity1785920305000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
  }
}
