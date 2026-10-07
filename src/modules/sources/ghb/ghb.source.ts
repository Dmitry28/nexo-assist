import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, parsePage } from './ghb.parser';

export const ghb = defineSource({
  id: 'ghb',
  host: HOST,
  sample: 'https://ghb.by/ru/construction/price_apartments/',
  about: 'жильё и офисы от застройщика (прейскурант)',
  searchPath: SEARCH_PATH,
  singlePage: true,
  // TODO [M]: no proxy — not measured from the Hetzner host; curl ghb.by from it after deploy.
  parse: parsePage,
});
