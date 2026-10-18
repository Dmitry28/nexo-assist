import { readFileSync } from 'fs';
import { join } from 'path';

import { SourceUnavailableError } from '../../source-adapter';
import { SEARCH_PATH, listingsFrom } from '../iaai.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('iaai listingsFrom', () => {
  const listings = listingsFrom(fixture('iaai-search.html'));

  it('reads each titled card once, stock number as the id', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['46218713', '46122379']);
    expect(listings[0]).toMatchObject({
      link: 'https://iaai.com/VehicleDetail/46718636~US',
      title: '2019 VOLKSWAGEN ATLAS 3.6L V6 SEL PREMIUM',
      priceText: 'Оценка: $18,283',
      address: 'West Palm Beach',
    });
    expect(listings[0]?.details).toEqual(
      expect.arrayContaining([
        { label: 'VIN', value: '1V2BR2CA0MC513881' },
        { label: 'Аукцион', value: 'IAAI' },
        { label: 'Повреждение', value: 'Flood' },
      ]),
    );
    expect(listings[1]?.priceText).toBe('Купить сейчас: $1,950');
  });

  it('treats a challenge page as the source not answering', () => {
    expect(() => listingsFrom('<html></html>')).toThrow(SourceUnavailableError);
  });
});

describe('iaai SEARCH_PATH', () => {
  it('takes /Search and refuses a vehicle page', () => {
    expect(SEARCH_PATH.test('/Search')).toBe(true);
    expect(SEARCH_PATH.test('/VehicleDetail/46718636~US')).toBe(false);
  });
});
