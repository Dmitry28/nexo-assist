import type { Logger } from '@nestjs/common';

import type { FetchResult, Listing } from '../source-adapter';

import { fetchHtml } from './http';

// NOTE: page-cap bound (not a time window) — deterministic and enough for daily volumes
// (e.g. 5 × ~30 = 150 listings). A lookback window can be added later if it proves wasteful.
//
// The cap is also what lets pages be fetched back-to-back with no pause: kufar rate-limits
// sustained pagination, and the prototype measured HTTP 429 on page 12 of a feed walked
// without a delay (land-scraper, kufar/constants/index.ts pauses 1.5 s for that reason).
// Five is far enough under it; raising this number means pacing the loop as well.
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
export async function paginate({
  firstUrl,
  host,
  parsePage,
  logger,
  useProxy,
}: {
  firstUrl: string;
  host: string;
  parsePage: (html: string, page: number) => ParsedPage;
  logger: Logger;
  /** Route fetches through SCRAPE_PROXY_URL — for sources that block datacenter IPs. */
  useProxy?: boolean;
}): Promise<FetchResult> {
  const byId = new Map<string, Listing>();
  let complete = true;
  let url: string | null = firstUrl;
  for (let page = 1; url !== null && page <= MAX_PAGES; page++) {
    let parsed: ParsedPage;
    try {
      parsed = parsePage(await fetchHtml({ url, host, useProxy }), page);
    } catch (err) {
      if (page === 1) throw err;
      // A prefix, not a failure — see FetchResult for what `complete` is for.
      complete = false;
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
  return { listings: [...byId.values()], complete };
}
