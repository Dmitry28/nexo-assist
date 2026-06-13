import type { KufarListing } from '@/modules/kufar/entities/kufar-listing.entity';

// Telegram caps a message at 4096 chars — cap the digest and link to the rest.
const MAX_PER_DIGEST = 10;

function price(listing: KufarListing): string {
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn} BYN`;
  return 'price n/a';
}

function formatOne(listing: KufarListing): string {
  return `${listing.title}\n${price(listing)}\n${listing.link}`;
}

/** A listings digest under `header`, capped with a "…and N more" footer. */
function digest(listings: KufarListing[], header: string): string {
  const shown = listings.slice(0, MAX_PER_DIGEST);
  const lines = shown.map(formatOne).join('\n\n');
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…and ${more} more` : '';
  return `${header}\n\n${lines}${footer}`;
}

export const formatNewListings = (listings: KufarListing[]): string =>
  digest(listings, `🆕 ${listings.length} new`);

export const formatCurrentListings = (listings: KufarListing[]): string =>
  digest(listings, `📋 ${listings.length} current`);
