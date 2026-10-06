import type { SourceDefinition } from '../source-definition';

import { HOST, parsePage } from './realt.parser';

/** realt.by — real estate. */
export const realt: SourceDefinition = {
  id: 'realt',
  host: HOST,
  // Newest first (verified live: sortType=createdAt orders by createdAt desc).
  pins: { sortType: 'createdAt' },
  page: { param: 'page', first: 1 },
  // No proxy: realt answers datacenter IPs (measured, PRODUCT_TECH.md).
  // realt redirects a search it rewrites (e.g. any `addressV2` filter) to a wider one.
  pinPath: true,
  parse: parsePage,
};
