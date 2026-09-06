import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConsecutiveFailures1783196783018 implements MigrationInterface {
  name = 'AddConsecutiveFailures1783196783018';

  // NOT NULL with a default — safe to add to a populated table (existing rows start at 0).
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "consecutiveFailures" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "consecutiveFailures"`);
  }
}
