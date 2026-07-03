import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';

import { extractPage, mapObject } from './realt.parser';

const HOST = 'realt.by';
// Pin newest-first ordering — the page-cap model relies on new listings being on page 1
// (verified live: sortType=createdAt orders by createdAt desc).
const SORT_NEWEST = 'createdAt';

/** realt.by source adapter — fetches a search newest-first, up to the page cap. */
@Injectable()
export class RealtAdapter implements SourceAdapter {
  readonly id: SourceId = 'realt';
  private readonly logger = new Logger(RealtAdapter.name);

  matches(url: string): boolean {
    return matchesHost(url, HOST);
  }

  async fetch(url: string): Promise<Listing[]> {
    const linkPath = this.linkPath(url);
    // NOTE: realt paginates by ?page=N. Pin newest-first and the start to page 1 (a pasted
    // URL may carry its own sort/page), then advance until pageSize × page covers totalCount.
    const base = withParam(url, 'sortType', SORT_NEWEST);
    return paginate(
      withParam(base, 'page', '1'),
      HOST,
      (html, page) => {
        const { objects, pagination } = extractPage(html);
        const hasMore = pagination !== null && page * pagination.pageSize < pagination.totalCount;
        const nextUrl = hasMore ? withParam(base, 'page', String(page + 1)) : null;
        return { listings: objects.map((obj) => mapObject(obj, linkPath)), nextUrl };
      },
      this.logger,
    );
  }

  // NOTE: object URLs are https://realt.by/<sale|rent>-<type>/object/<code>/ — derive the slug
  // from the search URL, which always carries a /<sale|rent>/<type>/ segment.
  private linkPath(url: string): string {
    const match = new URL(url).pathname.match(/\/(sale|rent)\/([a-z-]+)/);
    return match ? `${match[1]}-${match[2]}` : 'sale';
  }
}
