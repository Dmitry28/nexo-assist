import { Injectable, Logger } from '@nestjs/common';

import { paginate } from '../paginate';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';
import { withParam } from '../url';

import { extractPage, mapObject } from './realt.parser';

const HOST = 'realt.by';

/** realt.by source adapter — fetches and parses the first page of a search. */
@Injectable()
export class RealtAdapter implements SourceAdapter {
  readonly id: SourceId = 'realt';
  private readonly logger = new Logger(RealtAdapter.name);

  matches(url: string): boolean {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return false;
    }
    return hostname === HOST || hostname.endsWith(`.${HOST}`);
  }

  async fetch(url: string): Promise<Listing[]> {
    const linkPath = this.linkPath(url);
    // NOTE: realt paginates by ?page=N; advance until pageSize × page covers totalCount.
    let page = 1;
    return paginate(
      url,
      (html) => {
        const { objects, pagination } = extractPage(html);
        const hasMore = pagination !== null && page * pagination.pageSize < pagination.totalCount;
        const nextUrl = hasMore ? withParam(url, 'page', String(++page)) : null;
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
