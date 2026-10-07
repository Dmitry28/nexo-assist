import { defineSource } from '../source-definition';

import { HOST, SEARCH_PATH, parsePage } from './gsz.parser';

/**
 * gsz.gov.by — the state vacancy bank. TLS: the prototype needed its own CA bundle — see
 * PRODUCT_PLAN.md § Фаза 5.6, gsz.
 */
export const gsz = defineSource({
  id: 'gsz',
  host: HOST,
  sample: 'https://gsz.gov.by/registration/vacancy-search/?region=12380&district=14712',
  about: 'вакансии',
  // The search page only (exact path, trailing slash optional): a vacancy or a cabinet link would
  // fail every poll as "site down".
  searchPath: SEARCH_PATH,
  // Newest first, and the largest page the site offers (50) — the window is 3 requests.
  pins: { sort_by: 'sort_published_at_desc', paginate_by: '50' },
  page: { param: 'page', first: 1 },
  // TODO [M]: no proxy — not measured from the Hetzner host; curl gsz.gov.by from it after deploy.
  parse: parsePage,
});
