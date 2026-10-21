import { readFileSync } from 'fs';
import { join } from 'path';

import { SourceUnavailableError } from '../../source-adapter';
import { PROTECTION, SEARCH_PATH, parsePage } from '../av-by.parser';

const fixture = readFileSync(join(__dirname, 'fixtures', 'av-by-search.html'), 'utf8');
/** A page carrying this search state — the shape `__NEXT_DATA__` wraps it in. */
const pageWith = (main: unknown): string =>
  `<script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">${JSON.stringify({
    props: { initialState: { filter: { main } } },
  })}</script>`;

describe('av.by parsePage', () => {
  const { listings } = parsePage(fixture);

  it('maps an advert with both prices, its place, seller, raise time and photo', () => {
    expect(listings[0]).toMatchObject({
      externalId: '139627064',
      link: 'https://cars.av.by/volkswagen/atlas/139627064',
      title: 'Volkswagen Atlas 2024',
      priceUsd: 36700,
      priceByn: 110460,
      address: 'Молодечно, Минская обл.',
      seller: 'Автосалон',
      listTime: '2026-09-20T20:30:08+0000',
      images: ['https://avcdn.av.by/advertmedium/0015/4170/0923.jpg'],
    });
    expect(listings[0].details).toEqual([
      { label: 'Пробег', value: '7700 км' },
      { label: 'Двигатель', value: '2,0 бензин' },
      { label: 'Коробка', value: 'автомат' },
      { label: 'Кузов', value: 'внедорожник 5 дв.' },
      { label: 'Привод', value: 'подключаемый полный привод' },
      { label: 'Цвет', value: 'серый' },
    ]);
  });

  // The fixture's first advert is a paid «топ» from 2025 on a page of 2026 ones.
  it('drops a paid top advert older than the page', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['139627064', '141417399']);
  });

  it('reads an empty search — adverts null, count 0 — as no adverts', () => {
    const empty = pageWith({ adverts: null, count: 0 });

    expect(PROTECTION.usable(empty)).toBe(true);
    expect(parsePage(empty).listings).toEqual([]);
  });

  // The link goes inside <a href>: one off av.by, or none, is not ours to print.
  it('drops an advert without its own av.by link', () => {
    const ours = { id: 3, publicUrl: 'https://cars.av.by/bmw/x5/3' };
    const adverts = [{ id: 1, publicUrl: 'https://evil.example/1' }, { id: 2 }, ours];
    expect(parsePage(pageWith({ adverts, count: 3 })).listings.map((l) => l.externalId)).toEqual([
      '3',
    ]);
  });

  it('fails loudly when no advert carries an av.by link — publicUrl renamed?', () => {
    const adverts = [{ id: 1, publicUrl: 'https://evil.example/1' }, { id: 2 }];
    expect(() => parsePage(pageWith({ adverts, count: 2 }))).toThrow(SourceUnavailableError);
  });

  it('fails loudly when a search with adverts sends none', () => {
    expect(() => parsePage(pageWith({ adverts: null, count: 5 }))).toThrow(SourceUnavailableError);
  });
});

describe('av.by PROTECTION.usable', () => {
  it('tells the search page from the WAF challenge', () => {
    expect(PROTECTION.usable(fixture)).toBe(true);
    expect(PROTECTION.usable('<div id="slg-box"></div>')).toBe(false);
  });
});

describe('av.by SEARCH_PATH', () => {
  it.each(['/volkswagen', '/volkswagen/atlas', '/volkswagen/atlas/i-2-j-restajling-2023'])(
    'takes the landing page %s',
    (path) => expect(SEARCH_PATH.test(path)).toBe(true),
  );

  // /filter ignores its query and serves the whole catalogue; the number is an advert.
  it.each(['/filter', '/volkswagen/atlas/139627064'])('refuses %s', (path) =>
    expect(SEARCH_PATH.test(path)).toBe(false),
  );
});
