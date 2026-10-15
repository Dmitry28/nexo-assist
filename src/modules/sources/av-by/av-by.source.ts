import { defineSource } from '../source-definition';

import { HOST, PROTECTION, SEARCH_PATH, parsePage } from './av-by.parser';

/** cars.av.by — used cars, behind a WAF that lets Belarusian IPs through (see PROTECTION). */
export const avBy = defineSource({
  id: 'av-by',
  host: HOST,
  sample: 'https://cars.av.by/volkswagen/atlas/i-2-j-restajling-2023',
  // /filter links are refused (see SEARCH_PATH) — say which pages work.
  about: 'автомобили — страница марки или модели',
  searchPath: SEARCH_PATH,
  // One page per poll: a protected page may cost a paid request.
  singlePage: true,
  protection: PROTECTION,
  parse: parsePage,
});
