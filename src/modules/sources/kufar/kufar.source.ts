import { defineSource } from '../source-definition';

import { HOST, isGoneItem, matchAdOn, parseItem, parsePage } from './kufar.parser';

// Only re.kufar.by's ads are measured — another kufar subdomain's ad stays a «search» link.
const matchReAd = matchAdOn(`re.${HOST}`);
// kufar's own entry to any ad since 2026-10-21, what a reader now sees after a redirect: realty
// 301s on to re.kufar.by/vi/, a per-night ad stays here — the same ad view either way, read
// within kufar.by. Kept in this form (an id alone does not say which subdomain owns the ad).
const ITEM_PAGE = /^\/item\/(\d+)\/?$/;
function matchItem(url: string): { id: string; url: string } | null {
  const { hostname, pathname } = new URL(url);
  const id = hostname === `www.${HOST}` ? ITEM_PAGE.exec(pathname)?.[1] : undefined;
  return id ? { id, url: `https://www.${HOST}/item/${id}` } : matchReAd(url);
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
    parse: (html) => parseItem(html),
    isGone: isGoneItem,
  },
});
