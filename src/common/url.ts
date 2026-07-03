const URL_PATTERN = /https?:\/\/\S+/i;

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

/** First http(s) URL found in the text, or null. */
export function extractUrl(text: string): string | null {
  // NOTE: strip trailing punctuation glued by the greedy \S+ (e.g. "url).") — the URL is persisted.
  return text.match(URL_PATTERN)?.[0].replace(/[.,;:!?)\]}>]+$/, '') ?? null;
}

/** Whether the URL's hostname is `host` or one of its subdomains (e.g. re.kufar.by). */
export function matchesHost(url: string, host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
  return hostname === host || hostname.endsWith(`.${host}`);
}
