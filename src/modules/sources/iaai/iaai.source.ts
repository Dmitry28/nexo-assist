import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, USE_PROXY, load, parsePage } from './iaai.parser';

/** iaai.com — US salvage lots via the site's own search. */
export const iaai = defineSource({
  id: 'iaai',
  host: HOST,
  sample: 'https://iaai.com/Search?Keyword=volkswagen+atlas',
  about: 'аукцион США (IAAI)',
  searchPath: SEARCH_PATH,
  // Latest auction first, the site's own sort; the pager's page in the POST body (searchBody).
  page: { param: 'page', first: 1 },
  // Through the Oracle proxy: measured from the pod 2026-10-20 — direct from Hetzner, a 200 with no
  // search page (Imperva); through the proxy, the search (244 lot links).
  useProxy: USE_PROXY,
  load,
  parse: parsePage,
});
