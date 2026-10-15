import type { MigrationInterface, QueryRunner } from 'typeorm';

// Frozen on purpose: a migration runs on every fresh database for good, so it must not follow the
// live sources or url.ts — renaming a source or changing its pins later would change what this
// computes. These are each source's duplicate-check params as of 2026-10-07.
const PARAMS: Record<string, readonly string[]> = {
  kufar: ['sort', 'cursor'],
  'kufar-travel': ['sort', 'page'],
  realt: ['sortType', 'page'],
  gsz: ['sort_by', 'paginate_by', 'page'],
  rabota: ['order_by', 'items_on_page', 'page', 'search_session_id', 'hhtmFrom', 'hhtmFromLabel'],
};

// url.ts normalizeUrl as of 2026-10-07, copied for the same reason.
function normalize(url: string, params: readonly string[]): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.replace(/^www\./, '');
  for (const key of [...parsed.searchParams.keys()]) {
    if (params.includes(key) || key.startsWith('utm_')) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

export class RenormalizeSubscriptionUrls1791417600000 implements MigrationInterface {
  name = 'RenormalizeSubscriptionUrls1791417600000';

  // The duplicate check used to drop the UNION of all sources' params; now each source drops only
  // its own (a key that is noise on one site can be a filter on another). Each source's list is a
  // subset of the union, so a row only KEEPS more params: two distinct rows cannot become equal,
  // and the (userId, normalizedUrl) unique index cannot trip.
  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.manager.query<
      Array<{ id: string; source: string; url: string }>
    >(`SELECT "id", "source", "url" FROM "subscriptions"`);
    // One UPDATE a row: beta scale. Stored urls were validated on subscribe, so `new URL` holds.
    for (const row of rows) {
      const params = PARAMS[row.source];
      if (params === undefined) continue;
      await queryRunner.query(`UPDATE "subscriptions" SET "normalizedUrl" = $1 WHERE "id" = $2`, [
        normalize(row.url, params),
        row.id,
      ]);
    }
  }

  // Not reversible: re-normalizing with the old union could collide with rows added since.
  public async down(): Promise<void> {}
}
