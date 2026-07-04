import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1783163228738 implements MigrationInterface {
  name = 'InitSchema1783163228738';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegramUserId" bigint NOT NULL, "source" character varying NOT NULL, "url" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "baselinedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "seen_listings" ("subscriptionId" uuid NOT NULL, "externalId" character varying NOT NULL, "seenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_17b9c204c3e013cbe7d264c9811" PRIMARY KEY ("subscriptionId", "externalId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "seen_listings" ADD CONSTRAINT "FK_bb46b644d83e3591b9f4d75bc54" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "seen_listings" DROP CONSTRAINT "FK_bb46b644d83e3591b9f4d75bc54"`,
    );
    await queryRunner.query(`DROP TABLE "seen_listings"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
  }
}
