import { defineSource } from '../source-definition';

import { HOST, isGoneItem, parseItem, parsePage } from './kufar.parser';

// An ad's page: `/vi/<id>`, or its full form `/vi/<city>/<deal>/<type>/<id>` (the short one 301s
// there). Only re.kufar.by is measured — another kufar subdomain's ad stays a «search» link.
const ITEM_PATH = /^\/vi\/(?:[^/]+\/)*(\d+)\/?$/;
const ITEM_HOST = `re.${HOST}`;

function matchItem(url: string): { id: string; url: string } | null {
  const { hostname, pathname } = new URL(url);
  const id = hostname === ITEM_HOST ? ITEM_PATH.exec(pathname)?.[1] : undefined;
  return id ? { id, url: `https://${ITEM_HOST}/vi/${id}` } : null;
}

/** kufar.by — sale and long-term rent (re.kufar.by); its per-night rentals are kufar-travel. */
export const kufar = defineSource({
  id: 'kufar',
  host: HOST,
  sample: 'https://re.kufar.by/l/grodno/kupit/dom',
  about: 'продажа и аренда',
  // Newest first — the window relies on it (verified live: lst.d orders by list_time desc).
  pins: { sort: 'lst.d' },
  // Kufar pages by a cursor token appended to the search URL.
  cursor: { param: 'cursor' },
  // Kufar blocks datacenter IP ranges (403 «Доступ ограничен» from our host) — see PRODUCT_TECH.md.
  useProxy: true,
  parse: parsePage,
  item: {
    match: matchItem,
    parse: parseItem,
    isGone: isGoneItem,
  },
});
