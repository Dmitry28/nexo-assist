import { Injectable, Logger } from '@nestjs/common';

import type { Listing, SourceAdapter, SourceId } from '../source-adapter';

import { extractAds, mapAd } from './kufar.parser';

const HOST = 'kufar.by';
const FETCH_TIMEOUT_MS = 30_000;
// NOTE: a char cap (String.length is UTF-16 units, not bytes) — a coarse safety bound, not exact.
const MAX_HTML_LENGTH = 5 * 1024 * 1024;

// NOTE: a browser UA + ru locale is enough for Kufar to serve the SSR __NEXT_DATA__ — no Puppeteer.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

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
      // Bail before buffering the body when the server declares an oversized response.
      const contentLength = Number(res.headers.get('content-length'));
      if (contentLength > MAX_HTML_LENGTH) {
        this.logger.warn(`Content-Length ${contentLength} exceeds limit for ${url} — skipping`);
        return null;
      }
      const html = await res.text();
      if (html.length > MAX_HTML_LENGTH) {
        this.logger.warn(`Response too large (${html.length} chars) for ${url} — skipping`);
        return null;
      }
      return html;
    } catch (err) {
      this.logger.error({ err }, `Failed to fetch ${url}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
