import type { Listing } from '@/modules/sources/source-adapter';

/** Reusable "no link preview" message option. */
export const NO_LINK_PREVIEW = { is_disabled: true } as const;

// Cap the digest item count so the message stays small (Telegram's hard limit is 4096 chars).
// Exported for specs; production callers get the delivered slice from newListingsDigest.
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

export const formatCurrentListings = (listings: Listing[]): string =>
  digest(listings, `📋 ${listings.length} current`);

/**
 * The "new listings" digest plus the exact slice it shows. Callers must markSeen
 * only `delivered` — the overflow beyond the cap surfaces on a later run.
 * NOTE: newest-first means sustained volume > cap starves the oldest items; fixed
 * by batched delivery (Phase 7).
 */
export function newListingsDigest(fresh: Listing[]): { text: string; delivered: Listing[] } {
  return {
    text: digest(fresh, `🆕 ${fresh.length} new`),
    delivered: fresh.slice(0, DIGEST_LIMIT),
  };
}
