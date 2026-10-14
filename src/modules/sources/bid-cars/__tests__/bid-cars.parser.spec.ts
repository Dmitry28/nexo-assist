import { readFileSync } from 'fs';
import { join } from 'path';

import { PROTECTION, SEARCH_PATH, parsePage, requestUrl } from '../bid-cars.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('bid.cars parsePage', () => {
  const { listings } = parsePage(fixture('bid-cars-search.html'));

  it('reads each lot card with its facts, the bid as text', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['1-70620816', '0-45817719', '1-56514346']);
    expect(listings[0]).toMatchObject({
      link: 'https://bid.cars/ru/lot/1-70620816/2026-Volkswagen-Atlas-1V2HC2CA3TC232667',
      title: '2026 Volkswagen Atlas, SE',
      priceText: 'Текущая ставка: $8,800',
      address: 'Milwaukee... (WI)',
      listTime: '',
      images: [],
    });
    // «---» is the site's «no seller».
    expect(listings[0].seller).toBeUndefined();
    expect(listings[0].details).toEqual([
      { label: 'VIN', value: '1V2HC2CA3TC232667' },
      { label: 'Аукцион', value: 'COPART, чт 15 окт., 03:00 GMT+2' },
      { label: 'Пробег', value: '7k мили (12k km)' },
      { label: 'Повреждение', value: 'Незначительные вмятины / царапины' },
      { label: 'Документ', value: 'CD (Florida)' },
      { label: 'Состояние', value: 'На ходу' },
      { label: 'Двигатель', value: '2.0L 4 cyl. 269HP' },
      { label: 'Оценка', value: '$8,800 - $10,200' },
    ]);
  });

  it('shows both figures of a buy-now lot and keeps the insurer as the seller', () => {
    expect(listings[1]).toMatchObject({
      priceText: 'Текущая ставка: $25 · Купить сейчас: $14,125',
      seller: 'State Farm Group Insurance',
    });
  });
});

describe('bid.cars PROTECTION.usable', () => {
  it('takes a page with lots or the drawn «nothing found», not the unrendered shell', () => {
    expect(PROTECTION.usable(fixture('bid-cars-search.html'))).toBe(true);
    expect(PROTECTION.usable(fixture('bid-cars-empty.html'))).toBe(true);
    expect(parsePage(fixture('bid-cars-empty.html')).listings).toEqual([]);
    expect(PROTECTION.usable('<div class="items-row" id="search_area"> </div>')).toBe(false);
  });
});

describe('bid.cars requestUrl', () => {
  it('asks for the Russian page whatever the link’s language', () => {
    expect(requestUrl('https://bid.cars/en/search/results?make=Volkswagen')).toBe(
      'https://bid.cars/ru/search/results?make=Volkswagen',
    );
  });
});

describe('bid.cars SEARCH_PATH', () => {
  it.each(['/ru/search/results', '/en/search/results', '/search/results'])(
    'takes the search %s',
    (path) => expect(SEARCH_PATH.test(path)).toBe(true),
  );

  // A lot page and the archive are no search of active lots.
  it.each(['/ru/lot/1-70620816/x', '/ru/search/archived/results'])('refuses %s', (path) =>
    expect(SEARCH_PATH.test(path)).toBe(false),
  );
});
