const URL_PATTERN = /https?:\/\/\S+/i;

/** Return `url` with `key=value` set (added or replaced) — for building paginated page URLs. */
export function withParam(url: string, key: string, value: string): string {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

/** First http(s) URL found in the text, or null. */
export function extractUrl(text: string): string | null {
  // NOTE: strip trailing punctuation glued by the greedy \S+ (e.g. "url).") — the URL is persisted.
  return text.match(URL_PATTERN)?.[0].replace(/[.,;:!?)\]}>]+$/, '') ?? null;
}
