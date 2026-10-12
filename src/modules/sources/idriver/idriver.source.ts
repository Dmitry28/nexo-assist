import { defineSource } from '../source-definition';

import { HOST, PROTECTION, SEARCH_PATH, parsePage } from './idriver.parser';

/** idriver.by — the only source so far that only a paid anti-bot service can read (see PROTECTION). */
export const idriver = defineSource({
  id: 'idriver',
  host: HOST,
  sample: 'https://idriver.by/auto-parts/volkswagen/atlas-cross-sport',
  about: 'б/у запчасти с разборок',
  searchPath: SEARCH_PATH,
  pins: { sorter: 'fresh' },
  // One page per poll: the first screen is the 50 newest offers, and every page is a paid render.
  singlePage: true,
  protection: PROTECTION,
  parse: parsePage,
});
