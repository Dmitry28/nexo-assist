import type { Logger } from '@nestjs/common';

import type { Listing } from '../source-adapter';

import { fetchHtml } from './http';

// NOTE: page-cap bound (not a time window) — deterministic and enough for daily volumes
// (e.g. 5 × ~30 = 150 listings). A lookback window can be added later if it proves wasteful.
const MAX_PAGES = 5;

/** One parsed page: its listings and the URL of the next page (null = last page). */
export interface ParsedPage {
  listings: Listing[];
  nextUrl: string | null;
}

/**
 * Fetch pages newest-first via `parsePage` until there is no next page, a page is
 * empty, or MAX_PAGES is reached. Fetches are pinned to `host` (redirects must not
 * leave it). De-duplicates by externalId across pages (a listing can shift between
 * page fetches); seen-dedup happens in WatchService.
 *
 * A failed FIRST page — fetch or parse — throws: an outage, bot-wall or layout
 * change must not look like an empty search. A failure on a later page returns
 * what was collected (the newest pages are in).
 */
export async function paginate(
  firstUrl: string,
  host: string,
  parsePage: (html: string, page: number) => ParsedPage,
  logger: Logger,
): Promise<Listing[]> {
  const byId = new Map<string, Listing>();
  let url: string | null = firstUrl;
  for (let page = 1; url !== null && page <= MAX_PAGES; page++) {
    let parsed: ParsedPage;
    try {
      parsed = parsePage(await fetchHtml(url, host), page);
    } catch (err) {
      if (page === 1) throw err;
      logger.warn(
        { err },
        `Page ${page} failed for ${firstUrl} — returning ${byId.size} collected`,
      );
      break;
    }
    const { listings, nextUrl } = parsed;
    // Stop on an empty page — also guards against a loop if a page advertises a next but yields nothing.
    if (listings.length === 0) break;
    for (const listing of listings) {
      if (!byId.has(listing.externalId)) byId.set(listing.externalId, listing);
    }
    url = nextUrl;
  }
  return [...byId.values()];
}
