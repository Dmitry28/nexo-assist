import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { PageNotFoundError, SourceUnavailableError } from '@/modules/sources/source-adapter';
import type { SourceAdapter } from '@/modules/sources/source-adapter';
import { watchedItem } from '@/modules/sources/sources';

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-search.html'), 'utf8');
// Live pages of 2026-10-19 cut down to the ad view: an ad, and the 404 of a deleted one.
const item = readFileSync(join(__dirname, 'fixtures/kufar-vi.html'), 'utf8');
const gone = readFileSync(join(__dirname, 'fixtures/kufar-vi-gone.html'), 'utf8');

describe('kufar source', () => {
  const fetchMock = undiciFetchMock();
  let adapter: SourceAdapter;

  beforeEach(() => {
    adapter = sourceAdapter('kufar');
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
      ['https://travel.kufar.by/l/grodno/arendovat', false],
      ['https://realt.by/x', false],
      ['not a url', false],
    ])('matches(%s) → %s', (url, expected) => {
      expect(adapter.matches(url)).toBe(expected);
    });
  });

  describe('fetch', () => {
    it('fetches and parses listings from a search url', async () => {
      fetchMock.mockResolvedValue(new Response(fixture, { status: 200 }));

      const { listings } = await adapter.fetch('https://re.kufar.by/l/minsk/kupit/garazh');

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
  });

  describe('a single ad (item link)', () => {
    const ITEM = 'https://re.kufar.by/vi/1004282653';

    it.each([
      ['https://re.kufar.by/vi/1004282653', ITEM],
      ['https://re.kufar.by/vi/grodno/kupit/dom/1004282653?rank=3&searchId=x', ITEM],
      ['https://re.kufar.by/l/grodno/kupit/dom', undefined],
      // kufar's own ad entry since 2026-10-21 — what a reader sees after its redirect.
      ['https://www.kufar.by/item/1004282653/', 'https://www.kufar.by/item/1004282653'],
      // Only re.kufar.by is measured — another subdomain's ad stays a search link.
      ['https://auto.kufar.by/vi/1004282653', undefined],
    ])('reads %s as the item %s', (url, canonical) => {
      expect(adapter.matches(url)).toBe(true);
      expect(watchedItem('kufar', url)?.url).toBe(canonical);
    });

    it('reads the ad, with its full text, from its own page', async () => {
      fetchMock.mockResolvedValue(new Response(item, { status: 200 }));

      const result = await adapter.fetch(ITEM);

      expect(String(fetchMock.mock.calls[0][0])).toBe(ITEM); // no search pins on an ad's page
      expect(result).toEqual({ listings: [expect.any(Object)], complete: true, capped: false });
      expect(result.listings[0]).toMatchObject({
        externalId: '1004282653',
        title: 'Дом на проспекте Космонавтов',
        priceByn: 202000,
        priceUsd: 67114,
        description: expect.stringContaining('Проспект Космонавтов. Расположен'),
      });
    });

    it("calls the ad gone only on kufar's own «Ad is not found» 404", async () => {
      fetchMock.mockResolvedValue(new Response(gone, { status: 404 }));

      await expect(adapter.fetch(ITEM)).resolves.toEqual({
        listings: [],
        complete: true,
        capped: false,
        gone: true,
      });
    });

    it.each([
      ['another 404 page', 404, '<html>not found</html>', PageNotFoundError],
      ['an outage', 503, gone, SourceUnavailableError],
      // A page that is no item page (a layout change) is a loud parse failure.
      ['a page without the listing', 200, fixture, SourceUnavailableError],
    ])('treats %s as a failure, never as removed', async (_, status, body, error) => {
      fetchMock.mockResolvedValue(new Response(body, { status }));

      await expect(adapter.fetch(ITEM)).rejects.toThrow(error);
    });
  });
});
