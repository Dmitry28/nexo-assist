import type { Logger } from '@nestjs/common';

const FETCH_TIMEOUT_MS = 30_000;
// NOTE: a char cap (String.length is UTF-16 units, not bytes) — a coarse safety bound, not exact.
const MAX_HTML_LENGTH = 5 * 1024 * 1024;

// NOTE: a browser UA + ru locale is enough for kufar/realt to serve the SSR __NEXT_DATA__ — no Puppeteer.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

/** Fetch a page's HTML with a browser UA, timeout and size guards. Returns null on any failure. */
export async function fetchHtml(url: string, logger: Logger): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) {
      logger.warn(`HTTP ${res.status} for ${url}`);
      return null;
    }
    // Bail before buffering the body when the server declares an oversized response.
    const contentLength = Number(res.headers.get('content-length'));
    if (contentLength > MAX_HTML_LENGTH) {
      logger.warn(`Content-Length ${contentLength} exceeds limit for ${url} — skipping`);
      return null;
    }
    const html = await res.text();
    if (html.length > MAX_HTML_LENGTH) {
      logger.warn(`Response too large (${html.length} chars) for ${url} — skipping`);
      return null;
    }
    return html;
  } catch (err) {
    logger.error({ err }, `Failed to fetch ${url}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
