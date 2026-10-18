import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, USE_PROXY, load, parsePage } from './iaai.parser';

/** iaai.com — US salvage lots via the site's own search. */
export const iaai = defineSource({
  id: 'iaai',
  host: HOST,
  sample: 'https://iaai.com/Search?Keyword=volkswagen+atlas',
  about: 'аукцион США (IAAI)',
  searchPath: SEARCH_PATH,
  singlePage: true,
  // TODO [M]: measured from home 2026-10-18 (200 HTML); not from Hetzner. Imperva may refuse
  // the datacenter — then flip USE_PROXY and re-measure through Oracle.
  // One page (100 lots): the next 100 is another POST (`TODO [M]` if a wide search misses new ones).
  useProxy: USE_PROXY,
  load,
  parse: parsePage,
});
