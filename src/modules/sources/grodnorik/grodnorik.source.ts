import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, parsePage } from './grodnorik.parser';

export const grodnorik = defineSource({
  id: 'grodnorik',
  host: HOST,
  sample: 'https://grodnorik.gov.by/ru/auctions/',
  about: 'аукционы земли и домов (Гродненский райисполком)',
  searchPath: SEARCH_PATH,
  singlePage: true,
  // TODO [M]: no proxy — not measured from the Hetzner host (.gov.by may refuse foreign IPs).
  parse: parsePage,
});
