import type { HTMLElement } from 'node-html-parser';

import { SourceUnavailableError } from '../source-adapter';
import type { Listing, SourceId } from '../source-adapter';

import { asText } from './next-data';

/** An element's text, entities decoded and whitespace collapsed — sites pad markup freely. */
export const elementText = (element: HTMLElement | null | undefined): string | undefined =>
  asText(element?.textContent.replace(/\s+/g, ' '));

/**
 * The path a link points to on `host`, or undefined for a malformed href. Sites mix
 * http/https and www in their own links, so an id built from the path survives that.
 */
export function linkPath(href: string | undefined, host: string): string | undefined {
  try {
    return new URL(href ?? '', `https://${host}`).pathname;
  } catch {
    return undefined;
  }
}

/**
 * A page's cards as listings, once per id (unlike `withIds`, which keeps duplicates). Cards found
 * but none read is a layout change, not an empty search — thrown, so the source does not go silent.
 * NOTE: so a card selector must match listing cards only — a stray match on an empty search page
 * would fail the poll.
 */
export function cardListings<T>(
  cards: T[],
  toListing: (card: T) => Listing | undefined,
  source: SourceId,
): Listing[] {
  const byId = new Map<string, Listing>();
  for (const card of cards) {
    const listing = toListing(card);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  if (cards.length > 0 && byId.size === 0) {
    throw new SourceUnavailableError(`${source}: no card could be read — page layout changed?`);
  }
  return [...byId.values()];
}
