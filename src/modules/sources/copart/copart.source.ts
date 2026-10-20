import { MAX_LISTINGS } from '../source-adapter';
import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, load, parsePage, pollCredits } from './copart.parser';

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
  // every IP we have, so every page of the window is paid, at worst.
  paidPoll: pollCredits(MAX_LISTINGS),
  load,
  parse: parsePage,
});
