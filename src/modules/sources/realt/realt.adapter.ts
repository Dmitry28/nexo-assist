import { Injectable, Logger } from '@nestjs/common';

import { fetchHtml } from '../http';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';

import { extractObjects, mapObject } from './realt.parser';

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
    const html = await fetchHtml(url, this.logger);
    if (!html) return [];
    const linkPath = this.linkPath(url);
    return extractObjects(html).map((obj) => mapObject(obj, linkPath));
  }

  // NOTE: object URLs are https://realt.by/<sale|rent>-<type>/object/<code>/ — derive the slug
  // from the search URL, which always carries a /<sale|rent>/<type>/ segment.
  private linkPath(url: string): string {
    const match = new URL(url).pathname.match(/\/(sale|rent)\/([a-z-]+)/);
    return match ? `${match[1]}-${match[2]}` : 'sale';
  }
}
