import { ProxyAgent } from 'undici';

import { matchesHost } from '@/common/url';

const FETCH_TIMEOUT_MS = 30_000;
// NOTE: a char cap (String.length is UTF-16 units, not bytes) — a coarse safety bound, not exact.
const MAX_HTML_LENGTH = 5 * 1024 * 1024;

// Follow redirects ourselves (not the default 'follow') so each hop is host-checked before it
// is issued — see fetchFollowingHost. A small cap guards against redirect loops.
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// NOTE: a browser UA + ru locale is enough for kufar/realt to serve the SSR __NEXT_DATA__ — no Puppeteer.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

// Some sources block datacenter IP ranges, so their requests must leave through a proxy
// (see PRODUCT_TECH.md). The address is a deployment detail — read from the environment
// where it's used, like the OTEL_* vars in tracing.ts; it is declared and validated in
// env.validation.ts. Kept out of AppConfig on purpose: it carries credentials and the
// bootstrap logs the whole config object.
// One agent per address: it pools connections instead of opening a tunnel per request.
let proxyAgentCache: { url: string; agent: ProxyAgent } | undefined;

function proxyAgent(): ProxyAgent | undefined {
  const url = process.env.SCRAPE_PROXY_URL;
  if (!url) return undefined;
  if (proxyAgentCache?.url !== url) proxyAgentCache = { url, agent: new ProxyAgent(url) };
  return proxyAgentCache.agent;
}

/**
 * Fetch following redirects manually, validating every hop against `host` *before* it is
 * requested. The default `redirect: 'follow'` issues each intermediate request first and only
 * exposes the final URL — a redirect to an internal address (SSRF) would already be sent. With
 * `redirect: 'manual'` we resolve each `Location` (relative ones against the current URL) and
 * reject an off-host hop before following it.
 */
async function fetchFollowingHost(
  url: string,
  host: string,
  signal: AbortSignal,
  useProxy: boolean,
): Promise<Response> {
  // `dispatcher` is undici's per-request transport hook (undici powers global fetch); it is
  // absent from the DOM RequestInit types, hence the widened local type.
  const init: RequestInit & { dispatcher?: ProxyAgent } = {
    signal,
    headers: HEADERS,
    redirect: 'manual',
  };
  if (useProxy) init.dispatcher = proxyAgent();
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    const res = await fetch(currentUrl, init);
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects for ${url}`);
    const location = res.headers.get('location');
    if (location === null) return res; // broken redirect — let the caller's !res.ok check reject it
    const next = new URL(location, currentUrl).toString();
    if (!matchesHost(next, host)) {
      throw new Error(`Redirected off ${host} (${next}) for ${url}`);
    }
    currentUrl = next;
  }
}

/**
 * Fetch a page's HTML with a browser UA, timeout and size guards, pinned to `host`.
 * Throws on any failure — a failed fetch must stay distinguishable from an empty
 * search result, otherwise baseline/check silently treat outages as "no listings".
 *
 * `useProxy` routes the request through SCRAPE_PROXY_URL (for sources that block
 * datacenter IPs). No proxy configured → the request goes out directly.
 */
export async function fetchHtml({
  url,
  host,
  useProxy = false,
}: {
  url: string;
  host: string;
  useProxy?: boolean;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFollowingHost(url, host, controller.signal, useProxy);
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
