import { isGoneItem, matchAdOn, parseItem } from '../kufar/kufar.parser';
import { parseNextData } from '../scraping/next-data';
import { UnwatchableItemError } from '../source-adapter';
import { defineSource } from '../source-definition';

import { HOST, parsePage } from './kufar-travel.parser';

/** travel.kufar.by — kufar's per-night rentals: its own app and payload. */
export const kufarTravel = defineSource({
  id: 'kufar-travel',
  host: HOST,
  sample: 'https://travel.kufar.by/l/grodno/arendovat',
  about: 'посуточная аренда',
  // A pasted search may sort by rating (`sort=rtg`); newest first is verified live.
  pins: { sort: 'lst.d' },
  // A page holds `size` objects plus a few interleaved hotels (35 of 30, measured 2026-10-06).
  page: { param: 'page', first: 1 },
  // Same owner as kufar: blocks datacenter IP ranges (403 from the Hetzner pod, 2026-10-15).
  useProxy: true,
  parse: parsePage,
  // An object's page is kufar's ad view, the very payload and 404 kufar's own items have
  // (measured 2026-10-19). Linked as the stored /vi/ address: the ad's `ad_link` is www.kufar.by's.
  item: {
    match: matchAdOn(HOST),
    parse: (html, url) => {
      // A hotel's /vi/ link (our own cards use it) redirects to its /hotel/ page — no ad there,
      // and its price depends on the dates. Refused honestly instead of failing every poll.
      if (parseNextData(html)?.page === '/hotel') {
        throw new UnwatchableItemError(`kufar-travel: a hotel is not watched: ${url}`);
      }
      return { ...parseItem(html, 'kufar-travel'), link: url };
    },
    isGone: isGoneItem,
  },
});
