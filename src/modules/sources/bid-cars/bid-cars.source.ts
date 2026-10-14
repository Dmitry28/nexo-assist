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
  // One page per poll: every page is a paid render.
  singlePage: true,
  protection: PROTECTION,
  parse: parsePage,
});
