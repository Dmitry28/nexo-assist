import type { SourceId } from './entities/subscription.entity';

const SUPPORTED_SOURCES: ReadonlyArray<{ source: SourceId; host: string }> = [
  { source: 'kufar', host: 'kufar.by' },
  { source: 'realt', host: 'realt.by' },
];

const URL_PATTERN = /https?:\/\/\S+/i;

/** First http(s) URL found in the text, or null. */
export function extractUrl(text: string): string | null {
  // NOTE: strip trailing punctuation glued by the greedy \S+ (e.g. "url).") — the URL is persisted.
  return text.match(URL_PATTERN)?.[0].replace(/[.,;:!?)\]}>]+$/, '') ?? null;
}

/**
 * Supported source for a URL, or null. Host check only — full URL parsing lands
 * with the source adapters (Phase 2).
 */
export function sourceOf(url: string): SourceId | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }

  for (const { source, host } of SUPPORTED_SOURCES) {
    // NOTE: endsWith(".<host>") also matches subdomains like re.kufar.by.
    if (hostname === host || hostname.endsWith(`.${host}`)) return source;
  }
  return null;
}
