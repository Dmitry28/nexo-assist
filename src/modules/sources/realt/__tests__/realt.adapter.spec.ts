import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { SearchRewrittenError } from '../../source-adapter';
import { RealtAdapter } from '../realt.adapter';

const fixture = readFileSync(join(__dirname, 'fixtures/realt-search.html'), 'utf8');

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
  const fetchMock = undiciFetchMock();
  let adapter: RealtAdapter;

  beforeEach(() => {
    adapter = new RealtAdapter();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Measured 2026-10-06: any `addressV2` makes realt 302 to a wider search, filters dropped.
  it('refuses a search realt rewrites with a redirect, instead of following it', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://realt.by/belarus/sale/cottages' },
      }),
    );

    await expect(
      adapter.fetch('https://realt.by/grodno-region/sale/cottages/taunhaus/?addressV2=x'),
    ).rejects.toThrow(SearchRewrittenError);
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

      const { listings } = await adapter.fetch('https://realt.by/grodno-region/sale/plots/map/');

      expect(listings).toHaveLength(3);
      expect(listings[0].externalId).toBe('4152736');
      expect(listings[0].link).toBe('https://realt.by/sale-plots/object/4152736/');
    });

    it('falls back to the slug the page declares when the search URL has no segment', async () => {
      const page =
        '<script id="__NEXT_DATA__" type="application/json">' +
        JSON.stringify({
          props: {
            pageProps: {
              objects: [{ code: 7, updatedAt: '2026-01-01T00:00:00Z', priceRates: {} }],
              seoPayload: { parentUrl: '/rent/flats' },
            },
          },
        }) +
        '</script>';
      fetchMock.mockResolvedValue(new Response(page, { status: 200 }));

      const {
        listings: [listing],
      } = await adapter.fetch('https://realt.by/search/');

      expect(listing.link).toBe('https://realt.by/rent-flats/object/7/');
    });

    // The old code defaulted to `sale` here, and realt.by/sale/object/<code>/ answers 301 to the
    // /sale/ search page — so the reader landed on an unrelated list while the listing was
    // already marked seen. Failing the poll is the lesser evil: nothing gets marked.
    it('fails loudly when neither the page nor the URL yields a slug', async () => {
      const page =
        '<script id="__NEXT_DATA__" type="application/json">' +
        JSON.stringify({
          props: {
            pageProps: {
              objects: [{ code: 7, updatedAt: '2026-01-01T00:00:00Z', priceRates: {} }],
            },
          },
        }) +
        '</script>';
      fetchMock.mockResolvedValue(new Response(page, { status: 200 }));

      await expect(adapter.fetch('https://realt.by/search/')).rejects.toThrow('object-URL slug');
    });

    it('follows ?page=N until pagination is exhausted', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(realtPage([1], 2)))
        .mockResolvedValueOnce(new Response(realtPage([2], 2)));

      const { listings } = await adapter.fetch('https://realt.by/grodno-region/sale/plots/map/');

      expect(listings.map((l) => l.externalId)).toEqual(['1', '2']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
    });

    // realt bundles its first pages into page 1 (30…360 objects, measured 2026-10-06), so the
    // walk counts what arrived instead of multiplying our page number by its page size.
    const codes = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

    it('stops at the window after one bundled first page — no second request', async () => {
      fetchMock.mockResolvedValue(new Response(realtPage(codes(1, 360), 6589)));

      const { listings, capped } = await adapter.fetch('https://realt.by/sale/flats/');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(listings).toHaveLength(150);
      expect(capped).toBe(true);
    });

    it('walks a bundled first page to the end and never past it', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(realtPage(codes(1, 60), 133)))
        .mockResolvedValueOnce(new Response(realtPage(codes(61, 30), 133)))
        .mockResolvedValueOnce(new Response(realtPage(codes(91, 30), 133)))
        .mockResolvedValueOnce(new Response(realtPage(codes(121, 13), 133)));

      const { listings, capped } = await adapter.fetch(
        'https://realt.by/grodno-region/rent/flat-for-long/',
      );

      // The old `page × pageSize` asked for a fifth page past the end, which realt serves as page 1.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(listings).toHaveLength(133);
      expect(capped).toBe(false);
    });

    // totalCount counts what realt sent, so a dropped malformed object must not read as "more".
    it('stops at totalCount even when a malformed object was dropped', async () => {
      const page =
        '<script id="__NEXT_DATA__" type="application/json">' +
        JSON.stringify({
          props: {
            pageProps: {
              objects: [{ code: 1, updatedAt: '2026-01-01T00:00:00Z' }, { updatedAt: 'x' }],
              pagination: { totalCount: 2 },
            },
          },
        }) +
        '</script>';
      fetchMock.mockResolvedValue(new Response(page));

      const { listings, capped } = await adapter.fetch(
        'https://realt.by/grodno-region/sale/plots/',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(listings).toHaveLength(1);
      expect(capped).toBe(false);
    });

    it('pins page 1 and newest-first sort regardless of pasted params', async () => {
      fetchMock.mockResolvedValue(new Response(realtPage([1], 10)));

      await adapter.fetch('https://realt.by/grodno-region/sale/plots/map/?page=3&sortType=price');

      const firstUrl = String(fetchMock.mock.calls[0][0]);
      expect(firstUrl).toContain('page=1');
      expect(firstUrl).toContain('sortType=createdAt');
    });

    it('rejects on a non-OK response — an outage must not look like an empty search', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 404 }));

      await expect(adapter.fetch('https://realt.by/x')).rejects.toThrow('HTTP 404');
    });
  });
});
