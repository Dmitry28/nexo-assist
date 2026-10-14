import { defineSource } from '../source-definition';

import { HOST, PROTECTION, SEARCH_PATH, parsePage } from './bamper.parser';

/** bamper.by — used car parts, behind Cloudflare that lets Belarusian IPs through (see PROTECTION). */
export const bamper = defineSource({
  id: 'bamper',
  host: HOST,
  sample:
    'https://bamper.by/zchbu/zapchast_bamper-zadniy/marka_volkswagen/model_atlascrosssport/god_2023-2026/',
  about: 'б/у запчасти',
  searchPath: SEARCH_PATH,
  // Newest first: the value the page's own sort menu sets (seen live), as the prototype's links had.
  pins: { sort: 'DATE-DESC' },
  // One page per poll: a protected page may cost a paid request.
  singlePage: true,
  protection: PROTECTION,
  parse: parsePage,
});
