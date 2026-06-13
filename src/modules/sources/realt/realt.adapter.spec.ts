import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { RealtAdapter } from './realt.adapter';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/realt-search.html'), 'utf8');

// Minimal realt page for pagination tests: given object codes and a totalCount.
const realtPage = (codes: number[], totalCount: number): string =>
  '<script id="__NEXT_DATA__" type="application/json">' +
  JSON.stringify({
    props: {
      pageProps: {
        objects: codes.map((code) => ({ code, updatedAt: '2026-01-01T00:00:00Z', priceRates: {} })),
        pagination: { pageSize: 30, totalCount },
      },
    },
  }) +
  '</script>';

describe('RealtAdapter', () => {
  let adapter: RealtAdapter;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    adapter = new RealtAdapter();
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('matches', () => {
    it.each([
      ['https://realt.by/grodno-region/sale/plots/map/', true],
      ['https://www.realt.by/x', true],
      ['https://kufar.by/l/x', false],
    ])('matches(%s) → %s', (url, expected) => {
      expect(adapter.matches(url)).toBe(expected);
    });
  });

  describe('fetch', () => {
    it('parses listings and builds the link from the search-URL slug', async () => {
      fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));

      const listings = await adapter.fetch('https://realt.by/grodno-region/sale/plots/map/');

      expect(listings).toHaveLength(2);
      expect(listings[0].externalId).toBe('4152736');
      expect(listings[0].link).toBe('https://realt.by/sale-plots/object/4152736/');
    });

    it('follows ?page=N until pagination is exhausted', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(realtPage([1], 40)))
        .mockResolvedValueOnce(new Response(realtPage([2], 40)));

      const listings = await adapter.fetch('https://realt.by/grodno-region/sale/plots/map/');

      expect(listings.map((l) => l.externalId)).toEqual(['1', '2']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    });

    it('returns [] on a non-OK response', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 404 }));

      expect(await adapter.fetch('https://realt.by/x')).toEqual([]);
    });
  });
});
