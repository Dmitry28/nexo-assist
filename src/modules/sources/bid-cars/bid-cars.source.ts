import { defineSource } from '../source-definition';

import { HOST, PROTECTION, SEARCH_PATH, parsePage, requestUrl } from './bid-cars.parser';

/** bid.cars — US car auctions, behind Cloudflare that only a rendering service gets past. */
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
  // One page per poll: every page is a paid render.
  singlePage: true,
  protection: PROTECTION,
  parse: parsePage,
});
