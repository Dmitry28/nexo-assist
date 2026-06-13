import type { SourceId } from './entities/subscription.entity';

const SUPPORTED_SOURCES: ReadonlyArray<{ source: SourceId; host: string }> = [
  { source: 'kufar', host: 'kufar.by' },
  { source: 'realt', host: 'realt.by' },
];

const URL_PATTERN = /https?:\/\/\S+/i;

/** First http(s) URL found in the text, or null. */
export function extractUrl(text: string): string | null {
  // NOTE: greedy \S+ may keep trailing punctuation glued to the URL — harmless for host detection.
  return text.match(URL_PATTERN)?.[0] ?? null;
}

/**
 * Detect a supported source from pasted text. Returns null when there is no URL
 * or the host is not supported. Host check only — full URL parsing lands with
 * the source adapters (Phase 2).
 */
export function detectSource(text: string): { source: SourceId; url: string } | null {
  const url = extractUrl(text);
  if (!url) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }

  for (const { source, host } of SUPPORTED_SOURCES) {
    // NOTE: endsWith(".<host>") also matches subdomains like re.kufar.by.
    if (hostname === host || hostname.endsWith(`.${host}`)) {
      return { source, url };
    }
  }
  return null;
}
