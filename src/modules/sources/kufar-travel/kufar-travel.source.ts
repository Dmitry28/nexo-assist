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
});
