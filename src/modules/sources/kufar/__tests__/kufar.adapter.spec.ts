import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { KufarAdapter } from '../kufar.adapter';

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-search.html'), 'utf8');

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

    it('strips a pasted cursor and pins newest-first sort', async () => {
      fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));

      await adapter.fetch('https://re.kufar.by/l/minsk?cursor=abc&sort=prc.a');

      const firstUrl = String(fetchMock.mock.calls[0][0]);
      expect(firstUrl).not.toContain('cursor=');
      expect(firstUrl).toContain('sort=lst.d');
    });

    it('rejects on a non-OK response — an outage must not look like an empty search', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 404 }));

      await expect(adapter.fetch('https://re.kufar.by/l/x')).rejects.toThrow('HTTP 404');
    });

    it('rejects when the request throws', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(adapter.fetch('https://re.kufar.by/l/x')).rejects.toThrow('network down');
    });
  });
});
