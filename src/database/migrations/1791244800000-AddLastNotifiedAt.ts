import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastNotifiedAt1791244800000 implements MigrationInterface {
  name = 'AddLastNotifiedAt1791244800000';

  // Backfilled to now(), not left null: we cannot know when an existing user last got anything,
  // and null would fall back to signup — every long-standing user would be told «нового нет» on
  // the first run, including the ones who received cards yesterday.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "lastNotifiedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "users" SET "lastNotifiedAt" = now()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastNotifiedAt"`);
  }
}
