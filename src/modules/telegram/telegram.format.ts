import type { Listing } from '@/modules/sources/source-adapter';

// Telegram caps a message at 4096 chars — cap the digest and link to the rest.
// Exported so callers mark only the delivered slice as seen (overflow surfaces next run).
export const DIGEST_LIMIT = 10;

function price(listing: Listing): string {
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn} BYN`;
  return 'price n/a';
}

function formatOne(listing: Listing): string {
  return `${listing.title}\n${price(listing)}\n${listing.link}`;
}

/** A listings digest under `header`, capped with a "…and N more" footer. */
function digest(listings: Listing[], header: string): string {
  const shown = listings.slice(0, DIGEST_LIMIT);
  const lines = shown.map(formatOne).join('\n\n');
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…and ${more} more` : '';
  return `${header}\n\n${lines}${footer}`;
}

export const formatNewListings = (listings: Listing[]): string =>
  digest(listings, `🆕 ${listings.length} new`);

export const formatCurrentListings = (listings: Listing[]): string =>
  digest(listings, `📋 ${listings.length} current`);
