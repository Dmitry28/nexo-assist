import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, parsePage } from './prometr.parser';

export const prometr = defineSource({
  id: 'prometr',
  host: HOST,
  sample: 'https://prometr.by/newbuild_belarus/grodno/pogorany/',
  about: 'новостройки: квартиры в продаже по комплексу',
  searchPath: SEARCH_PATH,
  singlePage: true,
  // TODO [M]: no proxy — not measured from the Hetzner host; curl prometr.by from it after deploy.
  parse: parsePage,
});
