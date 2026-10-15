import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveTravelSubscriptions1791331200000 implements MigrationInterface {
  name = 'MoveTravelSubscriptions1791331200000';

  // Before the kufar-travel adapter, a travel.kufar.by link was saved as `kufar`: that adapter read
  // its page as an empty search, so the subscription never delivered — and re-sending the link
  // hits the duplicate check, so the user cannot repair it. Re-point it and re-baseline it: its
  // seen set holds nothing of travel's, so without the reset the first poll would send the window.
  // The old seen rows go too: a quiet re-baseline should start from what travel shows now.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH moved AS (
         UPDATE "subscriptions" SET "source" = 'kufar-travel', "baselinedAt" = NULL
         WHERE "source" = 'kufar' AND "url" ~* '^https?://(www\\.)?travel\\.kufar\\.by([/?#]|$)'
         RETURNING "id"
       )
       DELETE FROM "seen_listings" WHERE "subscriptionId" IN (SELECT "id" FROM moved)`,
    );
  }

  // Not reversible on purpose: `kufar` cannot read these pages, so moving them back breaks them.
  public async down(): Promise<void> {}
}
