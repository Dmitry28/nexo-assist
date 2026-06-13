import type { Logger } from '@nestjs/common';

import { fetchHtml } from './http';
import type { Listing } from './source-adapter';

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
 * empty, or MAX_PAGES is reached. Listings are returned across all fetched pages;
 * de-duplication against what was already delivered happens in WatchService.
 */
export async function paginate(
  firstUrl: string,
  parsePage: (html: string) => ParsedPage,
  logger: Logger,
): Promise<Listing[]> {
  const all: Listing[] = [];
  let url: string | null = firstUrl;
  for (let page = 1; url !== null && page <= MAX_PAGES; page++) {
    const html = await fetchHtml(url, logger);
    if (!html) break;
    const { listings, nextUrl } = parsePage(html);
    // Stop on an empty page — also guards against a loop if a page advertises a next but yields nothing.
    if (listings.length === 0) break;
    all.push(...listings);
    url = nextUrl;
  }
  return all;
}
