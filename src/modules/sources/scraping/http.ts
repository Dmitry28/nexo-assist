const FETCH_TIMEOUT_MS = 30_000;
// NOTE: a char cap (String.length is UTF-16 units, not bytes) — a coarse safety bound, not exact.
const MAX_HTML_LENGTH = 5 * 1024 * 1024;

// NOTE: a browser UA + ru locale is enough for kufar/realt to serve the SSR __NEXT_DATA__ — no Puppeteer.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

/**
 * Fetch a page's HTML with a browser UA, timeout and size guards.
 * Throws on any failure — a failed fetch must stay distinguishable from an empty
 * search result, otherwise baseline/check silently treat outages as "no listings".
 */
export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    // Bail before buffering the body when the server declares an oversized response.
    const contentLength = Number(res.headers.get('content-length'));
    if (contentLength > MAX_HTML_LENGTH) {
      throw new Error(`Content-Length ${contentLength} exceeds limit for ${url}`);
    }
    const html = await res.text();
    if (html.length > MAX_HTML_LENGTH) {
      throw new Error(`Response too large (${html.length} chars) for ${url}`);
    }
    return html;
  } finally {
    clearTimeout(timer);
  }
}
