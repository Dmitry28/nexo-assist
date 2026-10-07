import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, configUrl, parsePage } from './gridom.parser';

export const gridom = defineSource({
  id: 'gridom',
  host: HOST,
  sample: 'https://gridom.by/pogorany',
  about: 'квартиры от застройщиков (ЖК «Погораны» и др.)',
  searchPath: SEARCH_PATH,
  requestUrl: configUrl,
  // The widget's own link to a unit: same page, same search.
  noise: ['unit'],
  singlePage: true,
  // TODO [M]: no proxy — not measured from the Hetzner host; curl gridom.by from it after deploy.
  parse: parsePage,
});
