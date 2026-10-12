import type { Listing } from '@/modules/sources/source-adapter';

import type { PriceChange } from './price-change';

/** What a check found for the user: listings never delivered, and price changes on delivered ones. */
export interface Findings {
  listings: Listing[];
  priceChanges: PriceChange[];
}

/** Nothing to tell. */
export const isEmpty = (found: Findings): boolean =>
  found.listings.length === 0 && found.priceChanges.length === 0;
