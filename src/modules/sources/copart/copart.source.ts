import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, USE_PROXY, load, parsePage } from './copart.parser';

/** copart.com — US salvage lots via the site's public search JSON. */
export const copart = defineSource({
  id: 'copart',
  host: HOST,
  sample: 'https://copart.com/lotSearchResults?query=volkswagen+atlas',
  about: 'аукцион США (Copart)',
  searchPath: SEARCH_PATH,
  // Latest auction first — same proxy for «new» as bid.cars (a new lot is scheduled weeks out).
  page: { param: 'page', first: 0 },
  // TODO [M]: measured from home 2026-10-18 (200 JSON); not from Hetzner. Imperva may refuse
  // the datacenter — then flip USE_PROXY and re-measure through Oracle.
  useProxy: USE_PROXY,
  load,
  parse: parsePage,
});
