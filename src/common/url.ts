const URL_PATTERN = /https?:\/\/\S+/i;
// Longer pastes are junk — and echoing them back would blow Telegram's 4096-char reply limit.
const MAX_URL_LENGTH = 2048;

/** Return `url` with `key=value` set (added or replaced) — for building paginated page URLs. */
export function withParam(url: string, key: string, value: string): string {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

/** Return `url` without the given query param — e.g. a pasted link carrying its own cursor. */
export function withoutParam(url: string, key: string): string {
  const next = new URL(url);
  next.searchParams.delete(key);
  return next.toString();
}

/** First http(s) URL found in the text (bounded length), or null. */
export function extractUrl(text: string): string | null {
  // NOTE: strip trailing punctuation glued by the greedy \S+ (e.g. "url).") — the URL is persisted.
  const url = text.match(URL_PATTERN)?.[0].replace(/[.,;:!?)\]}>]+$/, '') ?? null;
  return url !== null && url.length <= MAX_URL_LENGTH ? url : null;
}

// Params that don't change a search's identity — pagination/order (adapters re-pin these
// anyway) and tracking. Dropped so the same search dedups however the link was pasted.
const VOLATILE_PARAMS = ['cursor', 'page', 'sort', 'sortType'];

/**
 * Canonical form of a search URL for dedup: lowercased host without `www.`, volatile and
 * `utm_*` params dropped, remaining params sorted, no trailing slash or fragment.
 * Heuristic and source-agnostic; refine per adapter only if a real collision shows up.
 */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.replace(/^www\./, '');
  for (const key of [...parsed.searchParams.keys()]) {
    if (VOLATILE_PARAMS.includes(key) || key.startsWith('utm_')) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

/** Whether the URL's hostname is `host` or one of its subdomains (e.g. re.kufar.by). */
export function matchesHost(url: string, host: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // An explicit (non-default) port could point the scraper at other services on the host.
  if (parsed.port !== '') return false;
  const hostname = parsed.hostname.replace(/^www\./, '');
  return hostname === host || hostname.endsWith(`.${host}`);
}
