import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPausedAt1783195101942 implements MigrationInterface {
  name = 'AddPausedAt1783195101942';

  // Nullable, no default — safe to add to a populated table (existing rows stay active).
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "pausedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "pausedAt"`);
  }
}
