import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNormalizedUrl1783187484846 implements MigrationInterface {
  name = 'AddNormalizedUrl1783187484846';

  // NOTE: adds a NOT NULL column without a default — assumes subscriptions is empty (it
  // runs at pre-launch setup). normalizeUrl() is JS-only, so a populated table would need
  // a nullable-add → app-side backfill → SET NOT NULL instead.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "normalizedUrl" text NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "UQ_c9b17fe79b8b2a56b9832223dba" UNIQUE ("userId", "normalizedUrl")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "UQ_c9b17fe79b8b2a56b9832223dba"`,
    );
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "normalizedUrl"`);
  }
}
