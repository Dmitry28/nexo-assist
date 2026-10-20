import { fetch, ProxyAgent } from 'undici';
import type { Dispatcher, RequestInit, Response } from 'undici';

import { matchesHost } from '@/common/url';

import { PageNotFoundError, SearchRewrittenError, SourceUnavailableError } from '../source-adapter';

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

/** Whether a proxy is configured at all — the ladder skips its rung otherwise. */
export const hasProxy = (): boolean => Boolean(process.env.SCRAPE_PROXY_URL);

function proxyAgent(): ProxyAgent | undefined {
  const url = process.env.SCRAPE_PROXY_URL;
  if (!url) return undefined;
  if (proxyAgentCache?.url !== url) proxyAgentCache = { url, agent: new ProxyAgent(url) };
  return proxyAgentCache.agent;
}

/** A URL's path with any trailing slash dropped — the part of a search a redirect may not change. */
const searchPath = (url: string): string => new URL(url).pathname.replace(/\/+$/, '');

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
  dispatcher,
  httpsOnly,
  pinPath,
  method = 'GET',
  headers,
  body,
}: {
  url: string;
  host: string;
  signal: AbortSignal;
  /** undici's per-request transport hook — a proxy agent, when the request is proxied. */
  dispatcher: Dispatcher | undefined;
  /** Refuse any hop that is not https — through a third-party proxy, cleartext could be altered. */
  httpsOnly: boolean;
  pinPath: boolean;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Response> {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; ; hop++) {
    if (httpsOnly && new URL(currentUrl).protocol !== 'https:') {
      throw new SourceUnavailableError(`not https through a public proxy: ${currentUrl}`);
    }
    const init: RequestInit & { dispatcher?: Dispatcher } = {
      signal,
      method: currentMethod,
      headers: { ...HEADERS, ...headers },
      redirect: 'manual',
      ...(currentBody !== undefined ? { body: currentBody } : {}),
      ...(dispatcher ? { dispatcher } : {}),
    };
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
    // Against the ORIGINAL path, not the previous hop's, so a chain of benign-looking hops cannot
    // walk away from it. A trailing slash is not a different search (realt 308s to add one).
    // NOTE: the path only, not the query — every rewrite measured changed the path, while query
    // normalization is routine and would make a query check fire on healthy searches.
    if (pinPath && searchPath(next) !== searchPath(url)) throw new SearchRewrittenError(url, next);
    currentUrl = next;
    // A 3xx after POST is followed as GET — the body belongs to the original verb.
    currentMethod = 'GET';
    currentBody = undefined;
  }
}

/**
 * Fetch a page's HTML with a browser UA, timeout and size guards, pinned to `host`.
 * Throws on any failure — a failed fetch must stay distinguishable from an empty
 * search result, otherwise baseline/check silently treat outages as "no listings".
 *
 * `useProxy` routes the request through SCRAPE_PROXY_URL (for sources that block
 * datacenter IPs). No proxy configured → the request goes out directly. `proxyUrl` routes it
 * through a third-party proxy instead (free-proxies.ts): https only — inside the CONNECT tunnel
 * TLS still verifies the site, so such a proxy sees the host name and can stall or drop, never
 * read or alter the page — and through an agent of its own, closed afterwards.
 *
 * `pinPath` turns a redirect to another path into SearchRewrittenError — for sources whose
 * redirects mean "not your search" (realt). Opt-in: kufar legitimately redirects
 * `www.kufar.by/l/…` to `re.kufar.by/listings?…`, a different path for the same search.
 */
export async function fetchHtml({
  url,
  host,
  useProxy = false,
  proxyUrl,
  pinPath = false,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal,
}: {
  url: string;
  host: string;
  useProxy?: boolean;
  proxyUrl?: string;
  pinPath?: boolean;
  /** Less than the default when the caller has a budget to keep (the ladder). */
  timeoutMs?: number;
  /** Cancels the request from outside — a raced attempt that lost. */
  signal?: AbortSignal;
}): Promise<string> {
  return fetchPinned({ url, host, useProxy, proxyUrl, pinPath, timeoutMs, signal });
}

/**
 * POST JSON to a host-pinned URL — Copart's search and IAAI's pager take a body, not a query.
 * Same timeout, size and proxy guards as fetchHtml.
 */
export async function fetchJson({
  url,
  host,
  body,
  useProxy = false,
  headers,
  timeoutMs,
}: {
  url: string;
  host: string;
  body: string;
  useProxy?: boolean;
  headers?: Record<string, string>;
  /** Less than the default when the caller has a budget to keep (the ladder). */
  timeoutMs?: number;
}): Promise<string> {
  return fetchPinned({
    url,
    host,
    useProxy,
    timeoutMs,
    method: 'POST',
    headers,
    body,
  });
}

async function fetchPinned({
  url,
  host,
  useProxy = false,
  proxyUrl,
  pinPath = false,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal,
  method,
  headers,
  body,
}: {
  url: string;
  host: string;
  useProxy?: boolean;
  proxyUrl?: string;
  pinPath?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, FETCH_TIMEOUT_MS));
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const ownAgent = proxyUrl === undefined ? undefined : new ProxyAgent(proxyUrl);
  try {
    const res = await fetchFollowingHost({
      url,
      host,
      signal: controller.signal,
      dispatcher: ownAgent ?? (useProxy ? proxyAgent() : undefined),
      httpsOnly: ownAgent !== undefined,
      pinPath,
      method,
      headers,
      body,
    });
    // A 404 body is read too: for a watched listing it is the site's own «no such ad» page.
    if (!res.ok && res.status !== 404) {
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
    // A timeout can land mid-body too — still the source not answering, not our bug.
    const html = await res.text().catch((err: unknown) => {
      throw new SourceUnavailableError(`body read failed for ${url}`, { cause: err });
    });
    if (html.length > MAX_HTML_LENGTH) {
      throw new SourceUnavailableError(`Response too large (${html.length} chars) for ${url}`);
    }
    if (res.status === 404) throw new PageNotFoundError(url, html);
    return html;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // A dead proxy must not leave its sockets open.
    void ownAgent?.destroy().catch(() => undefined);
  }
}
