import type { Listing } from '@/modules/sources/source-adapter';

/** At most this many phrases, and this many characters in all — a filter, not an essay. */
export const MAX_PHRASES = 10;
export const MAX_KEYWORDS_CHARS = 200;

const SEPARATOR = ', ';

// Lower case, ё as е, every run of whitespace (NBSP included — `\s` covers it) as one space.
const normalize = (text: string): string =>
  text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * A user's filter text as phrases: comma-separated, normalized, de-duplicated, capped. null when
 * nothing usable is left (empty, only commas) — the caller refuses it rather than clearing.
 */
export function parseKeywords(text: string): string[] | null {
  const phrases = [...new Set(text.split(',').map(normalize).filter(Boolean))].slice(
    0,
    MAX_PHRASES,
  );
  const kept: string[] = [];
  for (const phrase of phrases) {
    if ([...kept, phrase].join(SEPARATOR).length > MAX_KEYWORDS_CHARS) break;
    kept.push(phrase);
  }
  return kept.length > 0 ? kept : null;
}

/** How phrases are stored in `subscriptions.keywords`, and read back. */
export const storeKeywords = (phrases: string[]): string => phrases.join(SEPARATOR);
export const readKeywords = (stored: string | null): string[] | null =>
  stored ? stored.split(SEPARATOR) : null;

/**
 * Whether a text passes the filter: any phrase whose every word occurs in it. Substrings, so a
 * stem matches every ending («лобов стекл» — «Стекло лобовое», «лобового стекла»), and no `\b`:
 * in JS it knows only ASCII letters (the prototype's lesson). Word order is free.
 */
export const matchesKeywords = (text: string, phrases: string[]): boolean => {
  const haystack = normalize(text);
  return phrases.some((phrase) => phrase.split(' ').every((word) => haystack.includes(word)));
};

/** The text of a listing the filter reads: what a reader sees of it — title, text, place. */
const listingText = (listing: Pick<Listing, 'title' | 'description' | 'address'>): string =>
  [listing.title, listing.description, listing.address].filter(Boolean).join(' ');

/** Whether a listing passes a subscription's keyword filter. */
export const listingMatches = (
  listing: Parameters<typeof listingText>[0],
  phrases: string[],
): boolean => matchesKeywords(listingText(listing), phrases);
