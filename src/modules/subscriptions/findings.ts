import type { Listing } from '@/modules/sources/source-adapter';

import type { ListingSnapshot, PriceChange } from './price-change';

/** A delivered listing gone from its fixed sale list: sold. */
export interface Removal {
  externalId: string;
  last: ListingSnapshot;
}

/**
 * What a check found for the user: listings never delivered, price changes on delivered ones, and
 * delivered ones that were sold.
 */
export interface Findings {
  listings: Listing[];
  priceChanges: PriceChange[];
  removed: Removal[];
}

/** How many things there are to tell. */
export const countOf = (found: Findings): number =>
  found.listings.length + found.priceChanges.length + found.removed.length;

/** Nothing to tell. */
export const isEmpty = (found: Findings): boolean => countOf(found) === 0;
