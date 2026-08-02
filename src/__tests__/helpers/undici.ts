import { fetch } from 'undici';

/**
 * The stubbed undici `fetch` (see `__tests__/setup/mock-undici-fetch.ts`) — configure its
 * responses per test. `clearMocks` resets calls between tests, so no manual cleanup.
 */
export const undiciFetchMock = (): jest.Mock => fetch as unknown as jest.Mock;
