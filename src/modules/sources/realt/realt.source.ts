import { defineSource } from '../source-definition';

import { HOST, parsePage } from './realt.parser';

/** realt.by — real estate. */
export const realt = defineSource({
  id: 'realt',
  host: HOST,
  sample: 'https://realt.by/grodno-region/sale/plots/',
  about: 'недвижимость',
  // Newest first (verified live: sortType=createdAt orders by createdAt desc).
  pins: { sortType: 'createdAt' },
  page: { param: 'page', first: 1 },
  // No proxy: realt answers datacenter IPs (measured, PRODUCT_TECH.md).
  // realt redirects a search it rewrites (e.g. any `addressV2` filter) to a wider one.
  pinPath: true,
  parse: parsePage,
});
