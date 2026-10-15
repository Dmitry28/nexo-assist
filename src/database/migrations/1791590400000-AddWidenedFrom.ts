import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWidenedFrom1791590400000 implements MigrationInterface {
  name = 'AddWidenedFrom1791590400000';

  // The window grew 150 → 500 (MAX_LISTINGS). Every baselined subscription's seen set covers at most
  // the old 150, so the 350 below them would otherwise arrive as «new» on the next run — marked
  // here, seeded silently by that run (WatchService.check). A pending baseline needs nothing.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "widenedFrom" integer`);
    await queryRunner.query(
      `UPDATE "subscriptions" SET "widenedFrom" = 150 WHERE "baselinedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "widenedFrom"`);
  }
}
