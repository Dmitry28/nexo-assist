import { readFileSync } from 'fs';
import { join } from 'path';

import { PROTECTION, parsePage } from '../idriver.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('idriver parsePage', () => {
  const { listings } = parsePage(fixture('idriver-search.html'));

  it('reads every offer card with its id, link, title and microdata price', () => {
    expect(listings).toHaveLength(4);
    expect(listings[0]).toMatchObject({
      externalId: '119855234',
      link: 'https://idriver.by/auto-parts/nakladka-bokovaya-na-sidene/volkswagen/atlas-cross-sport/119855234',
      title: 'Накладка боковая на сиденье Volkswagen Atlas Cross Sport, 2021',
      priceByn: 62,
      address: 'Минск',
      seller: 'fixcar.by',
      listTime: '',
      images: [],
    });
    expect(listings[0].description).toContain('Из США');
  });

  it('keeps the donor car and the publication day as facts', () => {
    expect(listings[0].details).toEqual([
      { label: 'Авто', value: '2.0, Бензин, АКПП, Джип' },
      { label: 'Опубликовано', value: '14.09.2026' },
    ]);
    // The site writes single-digit days unpadded.
    expect(listings[3].details).toContainEqual({ label: 'Опубликовано', value: '03.11.2025' });
  });

  it('reads an empty catalogue as no offers — the page is real', () => {
    expect(parsePage('<select id="selectSorter"></select>').listings).toEqual([]);
  });
});

describe('idriver PROTECTION.usable', () => {
  it('tells the catalogue from the script stub', () => {
    expect(PROTECTION.usable(fixture('idriver-search.html'))).toBe(true);
    expect(PROTECTION.usable(fixture('idriver-stub.html'))).toBe(false);
  });
});
