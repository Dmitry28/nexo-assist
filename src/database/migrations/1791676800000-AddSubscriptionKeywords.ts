import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionKeywords1791676800000 implements MigrationInterface {
  name = 'AddSubscriptionKeywords1791676800000';

  // A subscription's keyword filter (keyword-filter.ts): NULL — every listing is delivered.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "keywords" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "keywords"`);
  }
}
