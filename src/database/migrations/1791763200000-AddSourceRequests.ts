import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSourceRequests1791763200000 implements MigrationInterface {
  name = 'AddSourceRequests1791763200000';

  // Who asked for an unsupported site (source-request.entity.ts), told once a parser ships. RLS on,
  // no policies — like every public table (EnableRowLevelSecurity explains why).
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "source_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegramId" bigint NOT NULL, "host" character varying NOT NULL, "url" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ea7c4c97c62f5da20262138eb96" UNIQUE ("telegramId", "host"), CONSTRAINT "PK_1eeb5cc85795084d4d77ddfd81a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "source_requests" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "source_requests"`);
  }
}
