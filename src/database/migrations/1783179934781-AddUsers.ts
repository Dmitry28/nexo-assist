import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsers1783179934781 implements MigrationInterface {
  name = 'AddUsers1783179934781';

  // NOTE: runs at initial schema setup (subscriptions is empty), so telegramUserId is
  // dropped and userId added NOT NULL without a data backfill.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegramId" bigint NOT NULL, "username" character varying, "firstName" character varying, "lastName" character varying, "language" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_df18d17f84763558ac84192c754" UNIQUE ("telegramId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "telegramUserId"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "userId" uuid NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_fbdba4e2ac694cf8c9cecf4dc84" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_fbdba4e2ac694cf8c9cecf4dc84"`,
    );
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" ADD "telegramUserId" bigint NOT NULL`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
