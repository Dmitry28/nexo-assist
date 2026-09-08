import { fetch, ProxyAgent } from 'undici';
import type { Dispatcher, RequestInit, Response } from 'undici';

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
// NOTE: fetch and ProxyAgent must come from the SAME undici — Node's built-in fetch runs on
// its own internal copy and rejects this package's dispatcher ("invalid onRequestStart method").
// One agent per address: it pools connections instead of opening a tunnel per request.
let proxyAgentCache: { url: string; agent: ProxyAgent } | undefined;

function proxyAgent(): ProxyAgent | undefined {
  const url = process.env.SCRAPE_PROXY_URL;
  if (!url) return undefined;
  if (proxyAgentCache?.url !== url) proxyAgentCache = { url, agent: new ProxyAgent(url) };
  return proxyAgentCache.agent;
}

/**
 * The source did not give us usable HTML — an error status, a timeout, a network failure, or a
 * response too large to accept. Distinct from a bug in our code: triage and alerting treat them
 * differently (a site misbehaving is not something we can fix, but its volume still matters).
 */
export class SourceUnavailableError extends Error {
  // Without this the issue title in Sentry reads "Error: HTTP 503" — the class name is what
  // makes the list scannable; the `kind` tag only helps once you are already filtering.
  override readonly name = 'SourceUnavailableError';
}

/**
 * Fetch following redirects manually, validating every hop against `host` *before* it is
 * requested. The default `redirect: 'follow'` issues each intermediate request first and only
 * exposes the final URL — a redirect to an internal address (SSRF) would already be sent. With
 * `redirect: 'manual'` we resolve each `Location` (relative ones against the current URL) and
 * reject an off-host hop before following it.
 */
async function fetchFollowingHost({
  url,
  host,
  signal,
  useProxy,
}: {
  url: string;
  host: string;
  signal: AbortSignal;
  useProxy: boolean;
}): Promise<Response> {
  // `dispatcher` is undici's per-request transport hook — set only when this source is proxied.
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    signal,
    headers: HEADERS,
    redirect: 'manual',
  };
  if (useProxy) init.dispatcher = proxyAgent();
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    // Only the network call is wrapped: a timeout or a refused connection means the source is
    // unreachable, while the guards below (off-host redirect, redirect loop) point at us or at
    // something suspicious and must stay distinguishable.
    let res: Response;
    try {
      res = await fetch(currentUrl, init);
    } catch (err) {
      throw new SourceUnavailableError(`request failed for ${currentUrl}`, { cause: err });
    }
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects for ${url}`);
    const location = res.headers.get('location');
    if (location === null) return res; // broken redirect — let the caller's !res.ok check reject it
    const next = new URL(location, currentUrl).toString();
    if (!matchesHost({ url: next, host })) {
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
    const res = await fetchFollowingHost({ url, host, signal: controller.signal, useProxy });
    if (!res.ok) {
      throw new SourceUnavailableError(`HTTP ${res.status} for ${url}`);
    }
    // Bail before buffering the body when the server declares an oversized response.
    // NOTE: only a DECLARED oversize is pre-empted — without Content-Length the body below is
    // buffered whole before the length check sees it, so the cap bounds what we keep, not what
    // we read. Enough for kufar/realt; a hostile source would need a streaming cap instead.
    const contentLength = Number(res.headers.get('content-length'));
    if (contentLength > MAX_HTML_LENGTH) {
      throw new SourceUnavailableError(`Content-Length ${contentLength} exceeds limit for ${url}`);
    }
    const html = await res.text();
    if (html.length > MAX_HTML_LENGTH) {
      throw new SourceUnavailableError(`Response too large (${html.length} chars) for ${url}`);
    }
    return html;
  } finally {
    clearTimeout(timer);
  }
}
