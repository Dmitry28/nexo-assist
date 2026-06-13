import { Injectable, Logger } from '@nestjs/common';

import { paginate } from '../paginate';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';
import { withParam } from '../url';

import { extractPage, mapAd } from './kufar.parser';

const HOST = 'kufar.by';

/** Kufar source adapter — fetches and parses the first page of a search. */
@Injectable()
export class KufarAdapter implements SourceAdapter {
  readonly id: SourceId = 'kufar';
  private readonly logger = new Logger(KufarAdapter.name);

  matches(url: string): boolean {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return false;
    }
    // NOTE: endsWith(".kufar.by") also matches subdomains like re.kufar.by.
    return hostname === HOST || hostname.endsWith(`.${HOST}`);
  }

  async fetch(url: string): Promise<Listing[]> {
    // NOTE: Kufar paginates by a cursor token appended to the original search URL.
    return paginate(
      url,
      (html) => {
        const { ads, nextCursor } = extractPage(html);
        return {
          listings: ads.map(mapAd),
          nextUrl: nextCursor ? withParam(url, 'cursor', nextCursor) : null,
        };
      },
      this.logger,
    );
  }
}
