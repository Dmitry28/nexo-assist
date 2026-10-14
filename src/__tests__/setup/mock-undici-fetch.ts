import type * as Undici from 'undici';

// Scraping goes through undici's fetch (see sources/scraping/http.ts — fetch and ProxyAgent
// must come from the same undici). Stub it for every unit spec: tests must never reach the
// network. Specs drive it via `undiciFetchMock()` from the helpers. Mocked here rather than
// per-spec because undici's exports are non-configurable, so `jest.spyOn` cannot replace them.
jest.mock('undici', () => ({
  ...jest.requireActual<typeof Undici>('undici'),
  fetch: jest.fn(),
}));

// The paid anti-bot keys: a developer's .env must not change which rungs a spec's ladder climbs
// (and the fetch above is what keeps a spec from spending them).
delete process.env.ZENROWS_API_KEY;
delete process.env.SCRAPE_DO_API_KEY;
delete process.env.SCRAPEOPS_API_KEY;
delete process.env.SCRAPINGANT_API_KEY;
delete process.env.SCRAPER_API_KEY;
delete process.env.SCRAPFLY_API_KEY;
