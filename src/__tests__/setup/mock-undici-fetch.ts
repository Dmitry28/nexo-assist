import type * as Undici from 'undici';

// Scraping goes through undici's fetch (see sources/scraping/http.ts — fetch and ProxyAgent
// must come from the same undici). Stub it for every unit spec: tests must never reach the
// network. Specs drive it via `undiciFetchMock()` from the helpers. Mocked here rather than
// per-spec because undici's exports are non-configurable, so `jest.spyOn` cannot replace them.
jest.mock('undici', () => ({
  ...jest.requireActual<typeof Undici>('undici'),
  fetch: jest.fn(),
}));
