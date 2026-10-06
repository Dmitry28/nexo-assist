import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { KufarAdapter } from '../../kufar/kufar.adapter';
import { KufarTravelAdapter } from '../kufar-travel.adapter';

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-travel-search.html'), 'utf8');

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

describe('KufarTravelAdapter', () => {
  const fetchMock = undiciFetchMock();
  let adapter: KufarTravelAdapter;

  beforeEach(() => {
    adapter = new KufarTravelAdapter();
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
    expect(new KufarAdapter().matches(url)).toBe(kufar);
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
});
