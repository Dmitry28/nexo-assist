import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { FetchResult, SourceAdapter, SourceId } from '../source-adapter';

import { HOST, extractPage, mapRentalObject } from './kufar-travel.parser';

// Pin newest-first: a pasted search may sort by rating (`sort=rtg`), and the window (MAX_LISTINGS
// newest) relies on new listings coming first. Verified live: accepted, orders by list time.
const SORT_NEWEST = 'lst.d';

/** travel.kufar.by source adapter — short-term rentals, newest-first, up to the window. */
@Injectable()
export class KufarTravelAdapter implements SourceAdapter {
  readonly id: SourceId = 'kufar-travel';
  private readonly logger = new Logger(KufarTravelAdapter.name);

  matches(url: string): boolean {
    return matchesHost({ url, host: HOST });
  }

  async fetch(url: string): Promise<FetchResult> {
    // NOTE: travel paginates by ?page=N and declares its page count. A page holds `size` objects
    // plus a few interleaved hotels (35 of 30, measured 2026-10-06); paginate dedupes any repeat by id.
    const base = withParam(url, 'sort', SORT_NEWEST);
    return paginate({
      firstUrl: withParam(base, 'page', '1'),
      host: HOST,
      parsePage: (html, page) => {
        const { objects, hasMore } = extractPage(html);
        return {
          listings: objects.map(mapRentalObject),
          nextUrl: hasMore ? withParam(base, 'page', String(page + 1)) : null,
        };
      },
      logger: this.logger,
      // Same owner as kufar, which blocks datacenter IP ranges; see PRODUCT_TECH.md for the proxy.
      // TODO [M]: assumed, not measured — curl travel.kufar.by from the Hetzner host; drop the
      // proxy if it answers 200 directly.
      useProxy: true,
    });
  }
}
