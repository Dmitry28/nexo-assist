import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { RealtAdapter } from './realt.adapter';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/realt-search.html'), 'utf8');

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

    it('returns [] on a non-OK response', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 404 }));

      expect(await adapter.fetch('https://realt.by/x')).toEqual([]);
    });
  });
});
