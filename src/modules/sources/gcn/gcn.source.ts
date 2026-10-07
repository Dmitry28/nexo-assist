import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, enrich, load, parsePage } from './gcn.parser';

export const gcn = defineSource({
  id: 'gcn',
  host: HOST,
  sample: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  about: 'аукционы земли и недвижимости (Гродненский центр недвижимости)',
  searchPath: SEARCH_PATH,
  singlePage: true,
  load,
  enrich,
  // TODO [M]: no proxy — not measured from the Hetzner host; curl gcn.by from it after deploy.
  parse: parsePage,
});
