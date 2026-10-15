import type { Logger } from '@nestjs/common';

import { wait } from '@/common/wait';

import { MAX_LISTINGS } from '../source-adapter';
import type { FetchResult, Listing } from '../source-adapter';

import { fetchHtml } from './http';

// NOTE: a count bound (MAX_LISTINGS newest, at most MAX_PAGES requests), not a time window —
// deterministic and enough for daily volumes. A lookback window can be added later if it proves
// wasteful.
// Outgrowing it is observable: the walk reports `capped`, and WatchService warns on overflow.
// Twenty pages hold the window on every paged source: kufar's 30 a page needs 17.
const MAX_PAGES = 20;

// Pages are fetched with a pause between them: kufar rate-limits sustained pagination, and the
// prototype measured HTTP 429 on page 12 of a feed walked without a delay (land-scraper,
// kufar/constants/index.ts pauses 1.5 s for that reason).
const PAGE_PAUSE_MS = 1500;

// No page starts after this long: twenty pages at the 30 s fetch timeout would hold one
// subscription for ten minutes, and a run is sequential (POLL_STUCK_AFTER_MS is sized on it).
// A healthy walk of the full window takes under a minute; one cut short reports `capped`.
const WALK_BUDGET_MS = 2 * 60 * 1000;

/** One parsed page: its listings and the URL of the next page (null = last page). */
export interface ParsedPage {
  listings: Listing[];
  nextUrl: string | null;
}

/**
 * Fetch pages newest-first via `parsePage` until there is no next page, a page is empty, MAX_PAGES
 * is reached, MAX_LISTINGS are collected (the result is trimmed to it) or WALK_BUDGET_MS has
 * passed. Fetches are pinned to
 * `host` (redirects must not leave it). De-duplicates by externalId across pages (a listing can
 * shift between page fetches); seen-dedup happens in WatchService.
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
  pinPath,
  load,
}: {
  firstUrl: string;
  host: string;
  parsePage: (html: string, page: number) => ParsedPage;
  logger: Logger;
  /** Route fetches through SCRAPE_PROXY_URL — for sources that block datacenter IPs. */
  useProxy?: boolean;
  /** Fail on a redirect to another path — see fetchHtml. */
  pinPath?: boolean;
  /** How to get a page's body, when it takes more than one request (gcn's grid); fetchHtml else. */
  load?: (url: string) => Promise<string>;
}): Promise<FetchResult> {
  const byId = new Map<string, Listing>();
  let complete = true;
  let capped = false;
  let url: string | null = firstUrl;
  const deadline = Date.now() + WALK_BUDGET_MS;
  for (let page = 1; url !== null && page <= MAX_PAGES && byId.size < MAX_LISTINGS; page++) {
    if (page > 1) {
      if (Date.now() >= deadline) {
        capped = true;
        logger.warn(
          `Walk budget spent before page ${page} of ${firstUrl} — returning ${byId.size}`,
        );
        break;
      }
      await wait(PAGE_PAUSE_MS);
    }
    let parsed: ParsedPage;
    try {
      const body = load ? await load(url) : await fetchHtml({ url, host, useProxy, pinPath });
      parsed = parsePage(body, page);
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
    // Set here, not from `url` after the loop: an empty-page break leaves `url` non-null too.
    const stopsHere = page === MAX_PAGES || byId.size >= MAX_LISTINGS;
    if (stopsHere && nextUrl !== null) capped = true;
  }
  // More than the window arrived (one big page can overshoot it): keep the newest, say so.
  if (byId.size > MAX_LISTINGS) capped = true;
  return { listings: [...byId.values()].slice(0, MAX_LISTINGS), complete, capped };
}
