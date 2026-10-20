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
  // Through the Oracle proxy: measured from the pod 2026-10-20 — direct from Hetzner, a 200 with no
  // search page (Imperva); through the proxy, the search (244 lot links).
  // One page (100 lots): the next 100 is another POST (`TODO [M]` if a wide search misses new ones).
  useProxy: USE_PROXY,
  load,
  parse: parsePage,
});
