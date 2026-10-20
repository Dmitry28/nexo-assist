import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, load, parsePage } from './copart.parser';

/** copart.com — US salvage lots via the site's public search JSON. */
export const copart = defineSource({
  id: 'copart',
  host: HOST,
  sample: 'https://copart.com/lotSearchResults?query=volkswagen+atlas',
  about: 'аукцион США (Copart)',
  searchPath: SEARCH_PATH,
  // Latest auction first — same proxy for «new» as bid.cars (a new lot is scheduled weeks out).
  page: { param: 'page', first: 0 },
  // Its requests climb the fetch ladder as a POST (copart.parser.ts `load`): Imperva refuses
  // every IP we have.
  // TODO [M]: paid pages outside the credit budget — `protection` admits one plain page only, so
  // Copart has no paidPoll: neither its subscriptions nor the bid.cars fallback's Copart walk (up
  // to 6 pages a poll) count against DAILY_CREDIT_BUDGET, though they draw on the same free tiers.
  load,
  parse: parsePage,
});
