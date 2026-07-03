import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam, withoutParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';

import { extractPage, mapAd } from './kufar.parser';

const HOST = 'kufar.by';
// Pin newest-first ordering — the page-cap model relies on new listings being on page 1
// (verified live: sort=lst.d orders by list_time desc).
const SORT_NEWEST = 'lst.d';

/** Kufar source adapter — fetches a search newest-first, up to the page cap. */
@Injectable()
export class KufarAdapter implements SourceAdapter {
  readonly id: SourceId = 'kufar';
  private readonly logger = new Logger(KufarAdapter.name);

  matches(url: string): boolean {
    return matchesHost(url, HOST);
  }

  async fetch(url: string): Promise<Listing[]> {
    // NOTE: Kufar paginates by a cursor token appended to the search URL. Strip a pasted
    // cursor (it would start mid-list and skip the newest pages) and pin newest-first.
    const base = withParam(withoutParam(url, 'cursor'), 'sort', SORT_NEWEST);
    return paginate(
      base,
      HOST,
      (html) => {
        const { ads, nextCursor } = extractPage(html);
        return {
          listings: ads.map(mapAd),
          nextUrl: nextCursor ? withParam(base, 'cursor', nextCursor) : null,
        };
      },
      this.logger,
    );
  }
}
