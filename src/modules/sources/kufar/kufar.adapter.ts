import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam, withoutParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { FetchResult, SourceAdapter, SourceId } from '../source-adapter';

import { HOST, extractPage, mapAd } from './kufar.parser';

// travel.kufar.by is another app with another payload (the kufar-travel adapter); its page reads
// here as an empty search (no `listing.ads` entries), so a subscription would never deliver.
const TRAVEL_HOST = 'travel.kufar.by';

// Pin newest-first ordering — the window (MAX_LISTINGS newest) relies on new listings coming first
// (verified live: sort=lst.d orders by list_time desc).
const SORT_NEWEST = 'lst.d';

/** Kufar source adapter — fetches a search newest-first, up to the window. */
@Injectable()
export class KufarAdapter implements SourceAdapter {
  readonly id: SourceId = 'kufar';
  private readonly logger = new Logger(KufarAdapter.name);

  matches(url: string): boolean {
    return matchesHost({ url, host: HOST }) && !matchesHost({ url, host: TRAVEL_HOST });
  }

  async fetch(url: string): Promise<FetchResult> {
    // NOTE: Kufar paginates by a cursor token appended to the search URL. Strip a pasted
    // cursor (it would start mid-list and skip the newest pages) and pin newest-first.
    const base = withParam(withoutParam(url, 'cursor'), 'sort', SORT_NEWEST);
    return paginate({
      firstUrl: base,
      host: HOST,
      parsePage: (html) => {
        const { ads, nextCursor } = extractPage(html);
        return {
          listings: ads.map(mapAd),
          nextUrl: nextCursor ? withParam(base, 'cursor', nextCursor) : null,
        };
      },
      logger: this.logger,
      // Kufar blocks datacenter IP ranges (403 «Доступ ограничен» from our host), so its
      // requests must leave through SCRAPE_PROXY_URL — see PRODUCT_TECH.md. realt needs no proxy.
      useProxy: true,
    });
  }
}
