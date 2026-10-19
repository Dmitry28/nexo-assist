import { readFileSync } from 'fs';
import { join } from 'path';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { SourceUnavailableError, UnsupportedSearchError } from '../../source-adapter';

const fixture = (folder: string, name: string): string =>
  readFileSync(join(__dirname, '..', '..', folder, '__tests__', 'fixtures', name), 'utf8');

const sample =
  'https://bid.cars/ru/search/results?search-type=filters&status=Active&type=Automobile&make=Volkswagen&model=Atlas';

const closedBidCars = (iaai: string): ((url: unknown) => Promise<Response>) => {
  return (url: unknown) => {
    const host = new URL(String(url)).host;
    if (host.endsWith('copart.com')) {
      return Promise.resolve(new Response(fixture('copart', 'copart-search.json')));
    }
    if (host.endsWith('iaai.com')) {
      return Promise.resolve(new Response(iaai));
    }
    return Promise.resolve(new Response('Just a moment…', { status: 403 }));
  };
};

describe('bid.cars fetch', () => {
  const adapter = sourceAdapter('bid-cars');
  const fetchMock = undiciFetchMock();

  it('reads bid.cars when the page opens and does not ask the auctions', async () => {
    fetchMock.mockResolvedValue(new Response(fixture('bid-cars', 'bid-cars-search.html')));

    const { listings } = await adapter.fetch(sample);

    expect(listings.map((row) => row.externalId)).toEqual([
      '1-70620816',
      '0-45817719',
      '1-56514346',
    ]);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['bid.cars']);
  });

  it('keeps an empty bid.cars page as empty — that search found nothing', async () => {
    fetchMock.mockResolvedValue(new Response(fixture('bid-cars', 'bid-cars-empty.html')));

    await expect(adapter.fetch(sample)).resolves.toMatchObject({ listings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads Copart and IAAI when bid.cars is closed', async () => {
    fetchMock.mockImplementation(closedBidCars(fixture('iaai', 'iaai-search.html')));

    const { listings } = await adapter.fetch(sample);

    expect(listings.map((row) => row.externalId)).toEqual([
      '0-46218713',
      '0-46122379',
      '1-46840646',
      '1-77707195',
    ]);
    expect(listings.map((row) => new URL(row.link).host)).toEqual([
      'iaai.com',
      'iaai.com',
      'copart.com',
      'copart.com',
    ]);
    expect(listings[2]?.coordinates).toEqual({ lat: 47.0864, lon: -122.433 });
    const iaai = fetchMock.mock.calls.find(([url]) => String(url).includes('iaai.com'))?.[1] as
      { body?: string } | undefined;
    expect(JSON.parse(iaai?.body ?? '')).toMatchObject({
      Searches: [{ FullSearch: 'volkswagen atlas' }],
    });
  });

  it('fails the fallback when a requested house does not answer', async () => {
    fetchMock.mockImplementation(closedBidCars('Just a moment…'));

    await expect(adapter.fetch(sample)).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it('keeps IAAI lots inside the pasted years', async () => {
    fetchMock.mockImplementation(closedBidCars(fixture('iaai', 'iaai-search.html')));

    const { listings } = await adapter.fetch(`${sample}&year-from=2018&year-to=2018`);

    expect(listings.filter((row) => row.externalId.startsWith('0-'))).toEqual([]);
  });

  it('marks the window capped when the auctions hold more than 500', async () => {
    const lots = Array.from({ length: 501 }, (_, i) => ({
      ln: 10000 + i,
      lotNumberStr: String(10000 + i),
      ld: `2018 VOLKSWAGEN ATLAS ${i}`,
    }));
    fetchMock.mockImplementation((url: unknown) => {
      const host = new URL(String(url)).host;
      if (host.endsWith('copart.com')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              returnCode: 1,
              data: { results: { totalElements: 900, content: lots } },
            }),
          ),
        );
      }
      if (host.endsWith('iaai.com')) {
        return Promise.resolve(new Response(fixture('iaai', 'iaai-search.html')));
      }
      return Promise.resolve(new Response('Just a moment…', { status: 403 }));
    });

    const { listings, capped } = await adapter.fetch(`${sample}&auction-type=Copart`);

    expect(capped).toBe(true);
    expect(listings).toHaveLength(500);
    expect(listings.every((row) => row.externalId.startsWith('1-'))).toBe(true);
  });

  it('refuses leftover filters instead of widening the auction search', async () => {
    fetchMock.mockResolvedValue(new Response('Just a moment…', { status: 403 }));

    await expect(adapter.fetch(`${sample}&damage=Flood`)).rejects.toBeInstanceOf(
      UnsupportedSearchError,
    );
    await expect(
      adapter.fetch('https://bid.cars/ru/search/results?auction-type=IAAI&type=Automobile'),
    ).rejects.toBeInstanceOf(UnsupportedSearchError);
  });
});
