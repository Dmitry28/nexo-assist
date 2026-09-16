import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import { SourceUnavailableError } from '../source-adapter';
import type { FetchResult, SourceAdapter, SourceId } from '../source-adapter';

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
    return matchesHost({ url, host: HOST });
  }

  async fetch(url: string): Promise<FetchResult> {
    const fromUrl = this.linkPath(url);
    // NOTE: realt paginates by ?page=N. Pin newest-first and the start to page 1 (a pasted
    // URL may carry its own sort/page), then advance until pageSize × page covers totalCount.
    const base = withParam(url, 'sortType', SORT_NEWEST);
    return paginate({
      firstUrl: withParam(base, 'page', '1'),
      host: HOST,
      parsePage: (html, page) => {
        const { objects, pagination, linkPath } = extractPage(html);
        // The search URL first, the page's own declaration second: `seoPayload.parentUrl` reads
        // `/` on region-prefixed pages (measured on /grodno-region/sale/cottages/), so it is the
        // weaker source of the two. Without either, see the linkPath docblock in realt.parser.
        const slug = fromUrl ?? linkPath;
        if (slug === null) {
          throw new SourceUnavailableError(`realt: no object-URL slug for ${url}`);
        }
        const hasMore = pagination !== null && page * pagination.pageSize < pagination.totalCount;
        const nextUrl = hasMore ? withParam(base, 'page', String(page + 1)) : null;
        return { listings: objects.map((obj) => mapObject(obj, slug)), nextUrl };
      },
      logger: this.logger,
    });
  }

  // NOTE: object URLs are https://realt.by/<sale|rent>-<type>/object/<code>/. Most search URLs
  // carry a /<sale|rent>/<type>/ segment to derive it from; null when they don't (see the
  // linkPath docblock in realt.parser for why a guess is worse than a failure).
  private linkPath(url: string): string | null {
    const match = new URL(url).pathname.match(/\/(sale|rent)\/([a-z-]+)/);
    return match ? `${match[1]}-${match[2]}` : null;
  }
}
