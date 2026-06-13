import { Injectable, Logger } from '@nestjs/common';

import type { KufarListing } from './entities/kufar-listing';
import { extractAds, mapAd } from './kufar.parser';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

// NOTE: a browser UA + ru locale is enough for Kufar to serve the SSR __NEXT_DATA__ — no Puppeteer.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

/** Fetches and parses the first page of a Kufar search. Pagination lands with the diff step. */
@Injectable()
export class KufarService {
  private readonly logger = new Logger(KufarService.name);

  async fetch(url: string): Promise<KufarListing[]> {
    const html = await this.fetchHtml(url);
    return html ? extractAds(html).map(mapAd) : [];
  }

  private async fetchHtml(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} for ${url}`);
        return null;
      }
      const html = await res.text();
      if (html.length > MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Response too large (${html.length} bytes) for ${url} — skipping`);
        return null;
      }
      return html;
    } catch (err) {
      this.logger.error(`Failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
