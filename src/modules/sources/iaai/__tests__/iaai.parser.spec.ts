import { readFileSync } from 'fs';
import { join } from 'path';

import { SourceUnavailableError } from '../../source-adapter';
import { SEARCH_PATH, listingsFrom, searchBody } from '../iaai.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('iaai listingsFrom', () => {
  const listings = listingsFrom(fixture('iaai-search.html'));

  it('reads each titled card once, the VehicleDetail id as the id', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['46718636', '46595810']);
    expect(listings[0]).toMatchObject({
      link: 'https://iaai.com/VehicleDetail/46718636~US',
      title: '2019 VOLKSWAGEN ATLAS 3.6L V6 SEL PREMIUM',
      priceText: 'Оценка: $18,283',
      address: 'West Palm Beach',
    });
    expect(listings[0]?.details).toEqual(
      expect.arrayContaining([
        { label: 'VIN', value: '1V2BR2CA0MC000001' },
        { label: 'Аукцион', value: 'IAAI' },
        { label: 'Stock', value: '46218713' },
        { label: 'Повреждение', value: 'Flood' },
        { label: 'Пробег', value: '89,003 mi' },
        { label: 'Двигатель', value: '3.6L V-6 DI' },
        { label: 'Запуск', value: 'Run and Drive' },
      ]),
    );
    expect(listings[1]?.priceText).toBe('Купить сейчас: $1,950');
  });

  it('treats a challenge page as the source not answering', () => {
    expect(() => listingsFrom('<html></html>')).toThrow(SourceUnavailableError);
    expect(() => listingsFrom('<a href="/VehicleDetail/1">x</a>')).toThrow(SourceUnavailableError);
  });
});

describe('iaai searchBody', () => {
  it('sends the Keyword and does not add filters the link did not ask for', () => {
    expect(searchBody('https://iaai.com/Search?Keyword=volkswagen+atlas')).toEqual({
      Searches: [{ FullSearch: 'volkswagen atlas' }],
      PageSize: 100,
      CurrentPage: 1,
      ReturnFacets: false,
      Sort: [{ SortField: 'AuctionDateTime', IsDescending: true, IsGeoSort: false }],
    });
  });
});

describe('iaai SEARCH_PATH', () => {
  it('takes /Search and refuses a vehicle page', () => {
    expect(SEARCH_PATH.test('/Search')).toBe(true);
    expect(SEARCH_PATH.test('/VehicleDetail/46718636~US')).toBe(false);
  });
});
