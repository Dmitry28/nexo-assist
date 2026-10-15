import { defineSource } from '../source-definition';

import { HOST, parsePage } from './kufar.parser';

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
});
