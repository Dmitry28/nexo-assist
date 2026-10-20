import { readFileSync } from 'fs';
import { join } from 'path';

import { SourceUnavailableError } from '../../source-adapter';
import {
  SEARCH_PATH,
  isSearchJson,
  listingsFrom,
  parsePage,
  searchBody,
  usdText,
} from '../copart.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('copart listingsFrom', () => {
  const listings = listingsFrom(fixture('copart-search.json'));

  it('reads each lot with the bid as text and the auction date on the house line', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['46840646', '77707195']);
    expect(listings[0]).toMatchObject({
      link: 'https://copart.com/lot/46840646/clean-title-2018-volkswagen-atlas-se-wa-spanaway',
      title: '2018 VOLKSWAGEN ATLAS SE',
      priceText: 'Купить сейчас: $3,475',
      address: 'WA - SPANAWAY',
      listTime: '',
    });
    expect(listings[0]?.details).toEqual(
      expect.arrayContaining([
        { label: 'VIN', value: '1V2CR2CA7JC123456' },
        { label: 'Аукцион', value: 'COPART, 2026-10-23' },
        { label: 'Пробег', value: '49183 mi' },
        { label: 'Двигатель', value: '2.0L 4' },
        { label: 'Запуск', value: 'Run and Drive' },
        { label: 'Повреждение', value: 'FRONT END' },
      ]),
    );
    expect(listings[1]?.priceText).toBe('Текущая ставка: $800 · Купить сейчас: $5,900');
    expect(listings[1]?.details.find((d) => d.label === 'VIN')).toBeUndefined();
  });

  it('treats a challenge page as the source not answering', () => {
    expect(() => listingsFrom('<html></html>')).toThrow(SourceUnavailableError);
    expect(listingsFrom('{"returnCode":1,"data":{"results":{"content":[]}}}')).toEqual([]);
    expect(() => listingsFrom('{"returnCode":1,"data":{"results":{"content":[{}]}}}')).toThrow(
      SourceUnavailableError,
    );
  });
});

const pageCtx = { url: '', page: 1, now: new Date(), sent: 0 };

describe('copart parsePage', () => {
  it('asks for another page while lots remain, and stops when they do not', () => {
    expect(parsePage(fixture('copart-search.json'), pageCtx).next).toBe(false);
    const more =
      '{"returnCode":1,"data":{"results":{"totalElements":200,"content":[{"lotNumberStr":"1","ld":"x"}]}}}';
    expect(parsePage(more, pageCtx).next).toBe(true);
    expect(
      parsePage('{"returnCode":1,"data":{"results":{"totalElements":200,"content":[]}}}', pageCtx)
        .next,
    ).toBe(false);
  });
});

describe('copart searchBody', () => {
  it('posts the link’s searchCriteria and only overrides page and sort', () => {
    const criteria = {
      query: ['*'],
      filter: { YEAR: ['lot_year:[2018 TO 2020]'], MAKE: ['lot_make_desc:"VOLKSWAGEN"'] },
      freeFormSearch: false,
    };
    const url = `https://www.copart.com/lotSearchResults?query=&page=2&searchCriteria=${encodeURIComponent(JSON.stringify(criteria))}`;
    expect(searchBody(url)).toEqual({
      ...criteria,
      page: 2,
      size: 100,
      start: 200,
      sort: ['auction_date_type desc', 'auction_date_utc desc'],
    });
  });

  it('uses make/model filters when the link names them and has no searchCriteria', () => {
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

describe('copart isSearchJson', () => {
  it("takes the search envelope, empty or not, and refuses Imperva's page", () => {
    expect(isSearchJson(fixture('copart-search.json'))).toBe(true);
    expect(isSearchJson('{"returnCode":1,"data":{"results":{"content":[]}}}')).toBe(true);
    expect(isSearchJson('<html style="height:100%"><head><META NAME="ROBOTS"')).toBe(false);
  });
});
