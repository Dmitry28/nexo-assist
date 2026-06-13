import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { KufarAdapter } from './kufar.adapter';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/kufar-search.html'), 'utf8');

describe('KufarAdapter', () => {
  let adapter: KufarAdapter;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    adapter = new KufarAdapter();
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('matches', () => {
    it.each([
      ['https://www.kufar.by/l/x', true],
      ['https://re.kufar.by/l/minsk', true],
      ['https://realt.by/x', false],
      ['not a url', false],
    ])('matches(%s) → %s', (url, expected) => {
      expect(adapter.matches(url)).toBe(expected);
    });
  });

  describe('fetch', () => {
    it('fetches and parses listings from a search url', async () => {
      fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));

      const listings = await adapter.fetch('https://re.kufar.by/l/minsk/kupit/garazh');

      expect(listings).toHaveLength(2);
      expect(listings[0].externalId).toBe('1069720654');
    });

    it('returns [] on a non-OK response', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 404 }));

      expect(await adapter.fetch('https://re.kufar.by/l/x')).toEqual([]);
    });

    it('returns [] when the request throws', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      expect(await adapter.fetch('https://re.kufar.by/l/x')).toEqual([]);
    });
  });
});
