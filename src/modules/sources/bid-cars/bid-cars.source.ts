import { pollCredits } from '../copart/copart.parser';
import { MAX_LISTINGS } from '../source-adapter';
import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, load, parsePage, requestUrl } from './bid-cars.parser';

/** bid.cars — US car auctions. Free page first; Copart+IAAI if Cloudflare blocks. */
export const bidCars = defineSource({
  id: 'bid-cars',
  host: HOST,
  sample:
    'https://bid.cars/ru/search/results?search-type=filters&status=Active&type=Automobile&make=Volkswagen&model=Atlas',
  about: 'авто с аукционов США',
  searchPath: SEARCH_PATH,
  requestUrl,
  // Latest auction first: the site has no «newest» order, and a new lot is scheduled weeks ahead
  // (assumed, not measured), so it lands at the top. The value its own sort menu sets; the link's
  // param is honoured (measured 2026-10-15).
  pins: { 'order-by': 'dateDesc' },
  singlePage: true,
  // Its fallback walks Copart's window plus the overflow marker (bid-cars.auctions.ts) — every
  // page paid, at worst; IAAI goes through our proxy, free.
  paidPoll: pollCredits(MAX_LISTINGS + 1),
  load,
  parse: parsePage,
});
