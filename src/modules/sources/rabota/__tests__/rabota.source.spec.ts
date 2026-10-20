import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { PageNotFoundError, SourceUnavailableError } from '@/modules/sources/source-adapter';
import { watchedItem } from '@/modules/sources/sources';

// The pause between pages is real time (paginate.ts); these specs test what is fetched, not when.
jest.mock('@/common/wait', () => ({ wait: () => Promise.resolve() }));

const fixture = readFileSync(join(__dirname, 'fixtures/rabota-search.html'), 'utf8');
const lastPage = readFileSync(join(__dirname, 'fixtures/rabota-empty.html'), 'utf8');
// Live pages of 2026-10-19 cut down to the state: a vacancy, the same closed, hh's 404.
const vacancy = readFileSync(join(__dirname, 'fixtures/rabota-vacancy.html'), 'utf8');
const archived = readFileSync(join(__dirname, 'fixtures/rabota-vacancy-archived.html'), 'utf8');
const gone = readFileSync(join(__dirname, 'fixtures/rabota-vacancy-gone.html'), 'utf8');

describe('rabota source', () => {
  const fetchMock = undiciFetchMock();

  it.each([
    ['https://rabota.by/search/vacancy?area=2302', true],
    ['https://rabota.by/search/vacancy/?area=2302', true],
    ['https://rabota.by/search/vacancy/advanced', false],
    // A vacancy's own page is watched as that vacancy (PRODUCT.md § «Одно объявление»).
    ['https://rabota.by/vacancy/138190032', true],
  ])('matches(%s) → %s', (url, expected) => {
    expect(sourceAdapter('rabota').matches(url)).toBe(expected);
  });

  // hh counts pages from 0: our first request is its page 0, the next its page 1.
  it('pins newest-first, 100 a page and page 0, then follows paging.next', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response(lastPage));

    await sourceAdapter('rabota').fetch(
      'https://rabota.by/search/vacancy?area=2302&order_by=salary_desc&items_on_page=20&page=3',
    );

    const [first, second] = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(first.get('order_by')).toBe('publication_time');
    expect(first.get('items_on_page')).toBe('100');
    expect(first.get('page')).toBe('0');
    expect(second.get('page')).toBe('1');
  });

  describe('a single vacancy (item link)', () => {
    const ITEM = 'https://rabota.by/vacancy/135454521';
    const adapter = sourceAdapter('rabota');

    it('reads the vacancy link without hh visit noise as its canonical form', () => {
      expect(watchedItem('rabota', `${ITEM}?hhtmFrom=vacancy_search_list`)?.url).toBe(ITEM);
      expect(watchedItem('rabota', 'https://rabota.by/search/vacancy?area=2302')).toBeUndefined();
    });

    it('reads the vacancy from its page, its salary as text and as a number', async () => {
      fetchMock.mockResolvedValue(new Response(vacancy));

      const { listings } = await adapter.fetch(ITEM);

      expect(listings).toEqual([
        expect.objectContaining({
          externalId: '135454521',
          priceText: expect.stringMatching(/^от 1\s600 руб\.$/), // grouped with a no-break space
          priceByn: 1600, // what makes a changed salary a price change
          listTime: '2026-10-13T11:52:06.37+03:00',
        }),
      ]);
    });

    it('compares a dollar salary in dollars', async () => {
      fetchMock.mockResolvedValue(
        new Response(vacancy.replace('&quot;BYR&quot;', '&quot;USD&quot;')),
      );

      const { listings } = await adapter.fetch(ITEM);

      expect(listings[0]).toMatchObject({ priceUsd: 1600, priceByn: undefined });
    });

    // A closed vacancy stays up (200) marked archived; an unknown one is hh's 404.
    it.each([
      ['a closed vacancy', 200, archived],
      ['an unknown vacancy', 404, gone],
    ])('calls %s gone', async (_, status, body) => {
      fetchMock.mockResolvedValue(new Response(body, { status }));

      await expect(adapter.fetch(ITEM)).resolves.toMatchObject({ listings: [], gone: true });
    });

    it.each([
      ['another 404 page', 404, '<html>not found</html>', PageNotFoundError],
      ['a page without the vacancy', 200, fixture, SourceUnavailableError],
    ])('treats %s as a failure, never as removed', async (_, status, body, error) => {
      fetchMock.mockResolvedValue(new Response(body, { status }));

      await expect(adapter.fetch(ITEM)).rejects.toThrow(error);
    });
  });
});
