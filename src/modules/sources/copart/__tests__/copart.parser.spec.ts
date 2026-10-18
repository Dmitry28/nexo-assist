import { readFileSync } from 'fs';
import { join } from 'path';

import { SourceUnavailableError } from '../../source-adapter';
import { SEARCH_PATH, listingsFrom, parsePage, searchBody, usdText } from '../copart.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('copart listingsFrom', () => {
  const listings = listingsFrom(fixture('copart-search.json'));

  it('reads each lot with the bid as text and the auction date as listTime', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['46840646', '77707195']);
    expect(listings[0]).toMatchObject({
      link: 'https://copart.com/lot/46840646/clean-title-2018-volkswagen-atlas-se-wa-spanaway',
      title: '2018 VOLKSWAGEN ATLAS SE',
      priceText: 'Купить сейчас: $3,475',
      address: 'WA - SPANAWAY',
      listTime: '2026-10-23T19:00:00.000Z',
    });
    expect(listings[0]?.details).toEqual(
      expect.arrayContaining([
        { label: 'VIN', value: '1V2CR2CA7JC123456' },
        { label: 'Аукцион', value: 'COPART' },
        { label: 'Пробег', value: '49183 mi' },
        { label: 'Повреждение', value: 'FRONT END' },
      ]),
    );
    expect(listings[1]?.priceText).toBe('Текущая ставка: $800 · Купить сейчас: $5,900');
    expect(listings[1]?.details.find((d) => d.label === 'VIN')).toBeUndefined();
  });

  it('treats a challenge page as the source not answering', () => {
    expect(() => listingsFrom('<html></html>')).toThrow(SourceUnavailableError);
    expect(listingsFrom('{"returnCode":1,"data":{"results":{"content":[]}}}')).toEqual([]);
  });
});

describe('copart parsePage', () => {
  it('stops when the page already holds every lot', () => {
    expect(
      parsePage(fixture('copart-search.json'), { url: '', page: 1, now: new Date(), sent: 0 }).next,
    ).toBe(false);
  });
});

describe('copart searchBody', () => {
  it('uses make/model filters when the link names them', () => {
    expect(
      searchBody('https://www.copart.com/lotSearchResults?make=Volkswagen&model=Atlas&page=1'),
    ).toMatchObject({
      page: 1,
      freeFormSearch: false,
      filter: {
        MAKE: ['lot_make_desc:"VOLKSWAGEN"'],
        MODEL: ['lot_model_desc:"ATLAS"'],
      },
    });
  });
});

describe('copart SEARCH_PATH', () => {
  it('takes the lot board and refuses a lot page', () => {
    expect(SEARCH_PATH.test('/lotSearchResults')).toBe(true);
    expect(SEARCH_PATH.test('/lot/46840646')).toBe(false);
  });
});

describe('usdText', () => {
  it('skips zero and formats thousands', () => {
    expect(usdText(0)).toBeUndefined();
    expect(usdText(3475)).toBe('$3,475');
  });
});
