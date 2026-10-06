import type { SourceDefinition } from '../source-definition';

import { HOST, SEARCH_PATH, parsePage } from './rabota.parser';

/** rabota.by — hh.ru's Belarusian site, vacancies. */
export const rabota: SourceDefinition = {
  id: 'rabota',
  host: HOST,
  // The results page only: `/search/vacancy/advanced` is the search form.
  searchPath: SEARCH_PATH,
  // hh sorts by relevance unless told; 100 a page (its most) makes the window two requests.
  pins: { order_by: 'publication_time', items_on_page: '100' },
  page: { param: 'page', first: 0 },
  // hh's per-visit params, carried by its pager links and pasted URLs — they name no search.
  noise: ['search_session_id', 'hhtmFrom', 'hhtmFromLabel'],
  // TODO [M]: no proxy — not measured from the Hetzner host; the prototype saw plain requests
  // fail there. curl rabota.by from it and set useProxy from the answer.
  parse: parsePage,
};
