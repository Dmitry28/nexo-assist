import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { PageNotFoundError, UnwatchableItemError } from '@/modules/sources/source-adapter';
import type { SourceAdapter } from '@/modules/sources/source-adapter';
import { watchedItem } from '@/modules/sources/sources';

// The pause between pages is real time (paginate.ts); these specs test what is fetched, not when.
jest.mock('@/common/wait', () => ({ wait: () => Promise.resolve() }));

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-travel-search.html'), 'utf8');
// Live pages of 2026-10-19, cut down: a flat's ad, and where a hotel's /vi/ link lands.
const item = readFileSync(join(__dirname, 'fixtures/kufar-travel-vi.html'), 'utf8');
const hotel = readFileSync(join(__dirname, 'fixtures/kufar-travel-hotel.html'), 'utf8');
// kufar's own «Ad is not found» 404 — travel answers an unknown ad with the same page.
const gone = readFileSync(
  join(__dirname, '../../kufar/__tests__/fixtures/kufar-vi-gone.html'),
  'utf8',
);

const lastPage = (adId: number): string =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      initialState: {
        listing: {
          rentalObjects: [{ adId, listTime: '2026-01-01T00:00:00Z' }],
          bookingPaginator: { page: 2, pages: 2 },
        },
      },
    },
  })}</script>`;

describe('kufar-travel source', () => {
  const fetchMock = undiciFetchMock();
  let adapter: SourceAdapter;

  beforeEach(() => {
    adapter = sourceAdapter('kufar-travel');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The two kufar adapters split one domain: neither may take the other's links.
  it.each([
    ['https://travel.kufar.by/l/grodno/arendovat', true, false],
    ['https://re.kufar.by/l/grodno/snyat/kvartiru', false, true],
    ['https://www.kufar.by/l/x', false, true],
  ])('%s → travel %s, kufar %s', (url, travel, kufar) => {
    expect(adapter.matches(url)).toBe(travel);
    expect(sourceAdapter('kufar').matches(url)).toBe(kufar);
  });

  it('pins newest-first and page 1, then walks ?page=N while the paginator says more', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response(lastPage(7)));

    const { listings } = await adapter.fetch(
      'https://travel.kufar.by/l/grodno/arendovat?sort=rtg&page=4',
    );

    const [first, second] = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(first.searchParams.get('sort')).toBe('lst.d');
    expect(first.searchParams.get('page')).toBe('1');
    expect(second.searchParams.get('page')).toBe('2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listings.map((l) => l.externalId)).toEqual(['1079283982', '1054122264', '7']);
  });

  describe('a single object (item link)', () => {
    const ITEM = 'https://travel.kufar.by/vi/1089976321';

    it.each([
      ['https://travel.kufar.by/vi/1089976321', ITEM],
      ['https://travel.kufar.by/vi/grodno/1089976321?arrivalDate=1', ITEM],
      ['https://travel.kufar.by/l/grodno/arendovat', undefined],
    ])('reads %s as the item %s', (url, canonical) => {
      expect(adapter.matches(url)).toBe(true);
      expect(watchedItem('kufar-travel', url)?.url).toBe(canonical);
    });

    it('reads the object from its page (kufar ad view), linked by its stored address', async () => {
      fetchMock.mockResolvedValue(new Response(item, { status: 200 }));

      const { listings } = await adapter.fetch(ITEM);

      expect(listings).toEqual([
        expect.objectContaining({
          externalId: '1089976321',
          priceByn: 350,
          priceUsd: 116,
          link: ITEM,
        }),
      ]);
    });

    const moved = (location: string) => new Response(null, { status: 301, headers: { location } });

    it("follows kufar's redirect to www.kufar.by/item — the same ad view", async () => {
      fetchMock
        .mockResolvedValueOnce(moved('https://www.kufar.by/item/1089976321'))
        .mockResolvedValueOnce(new Response(item, { status: 200 }));

      const { listings } = await adapter.fetch(ITEM);

      expect(listings).toEqual([expect.objectContaining({ externalId: '1089976321', link: ITEM })]);
    });

    it('still refuses a redirect off kufar.by', async () => {
      fetchMock.mockResolvedValueOnce(moved('https://evil.example/1089976321'));

      await expect(adapter.fetch(ITEM)).rejects.toThrow('Redirected off');
    });

    it('refuses a hotel — its link lands on a page without an ad', async () => {
      fetchMock.mockResolvedValue(new Response(hotel, { status: 200 }));

      await expect(adapter.fetch(ITEM)).rejects.toThrow(UnwatchableItemError);
    });

    it("calls the object gone only on kufar's «Ad is not found» 404", async () => {
      fetchMock.mockResolvedValueOnce(new Response(gone, { status: 404 }));
      await expect(adapter.fetch(ITEM)).resolves.toMatchObject({ listings: [], gone: true });

      fetchMock.mockResolvedValueOnce(new Response('<html>not found</html>', { status: 404 }));
      await expect(adapter.fetch(ITEM)).rejects.toThrow(PageNotFoundError);
    });
  });
});
