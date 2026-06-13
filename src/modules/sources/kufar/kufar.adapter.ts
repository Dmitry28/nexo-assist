import { Injectable, Logger } from '@nestjs/common';

import { fetchHtml } from '../http';
import type { Listing, SourceAdapter, SourceId } from '../source-adapter';

import { extractAds, mapAd } from './kufar.parser';

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
    const html = await fetchHtml(url, this.logger);
    return html ? extractAds(html).map(mapAd) : [];
  }
}
