import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, isGoneItem, parseItem, parsePage } from './rabota.parser';

const ITEM_PATH = /^\/vacancy\/(\d+)\/?$/;

function matchItem(url: string): { id: string; url: string } | null {
  const id = ITEM_PATH.exec(new URL(url).pathname)?.[1];
  return id ? { id, url: `https://${HOST}/vacancy/${id}` } : null;
}

/** rabota.by — hh.ru's Belarusian site, vacancies. */
export const rabota = defineSource({
  id: 'rabota',
  host: HOST,
  sample: 'https://rabota.by/search/vacancy?area=2302',
  about: 'вакансии',
  // The results page only: `/search/vacancy/advanced` is the search form.
  searchPath: SEARCH_PATH,
  // hh sorts by relevance unless told; 100 a page (its most) makes the window five requests.
  pins: { order_by: 'publication_time', items_on_page: '100' },
  page: { param: 'page', first: 0 },
  // hh's per-visit params, carried by its pager links and pasted URLs — they name no search.
  noise: ['search_session_id', 'hhtmFrom', 'hhtmFromLabel'],
  // TODO [M]: no proxy — not measured from the Hetzner host; the prototype saw plain requests
  // fail there. curl rabota.by from it and set useProxy from the answer.
  parse: parsePage,
  // A vacancy's page: `/vacancy/<id>` (rabota.by's own link form; the search builds it too).
  item: { match: matchItem, parse: parseItem, isGone: isGoneItem },
});
