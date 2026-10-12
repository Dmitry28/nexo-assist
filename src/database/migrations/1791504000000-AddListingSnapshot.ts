import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingSnapshot1791504000000 implements MigrationInterface {
  name = 'AddListingSnapshot1791504000000';

  // No backfill: a NULL snapshot is filled silently by the next poll that sees the listing.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "seen_listings" ADD "snapshot" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "seen_listings" DROP COLUMN "snapshot"`);
  }
}
