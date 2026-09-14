import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { extractPage, mapObject } from '../realt.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/realt-search.html'), 'utf8');

describe('extractPage', () => {
  it('reads objects and the pagination block', () => {
    const { objects, pagination } = extractPage(fixture);

    expect(objects).toHaveLength(3);
    expect(objects[0].code).toBe(4152736);
    expect(pagination?.totalCount).toBe(3);
  });

  // The type is asserted, not just the message: Sentry derives `kind` from it (see the
  // SourceUnavailableError docblock in scraping/http.ts).
  it('throws when __NEXT_DATA__ is absent — a bot-wall must not read as an empty search', () => {
    const thrown = () => extractPage('<html>no data</html>');

    expect(thrown).toThrow('__NEXT_DATA__');
    expect(thrown).toThrow(SourceUnavailableError);
  });

  it('throws when pageProps is missing — a layout change must not read as an empty search', () => {
    const noPageProps =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: {} }) +
      '</script>';

    expect(() => extractPage(noPageProps)).toThrow('pageProps');
    expect(() => extractPage(noPageProps)).toThrow(SourceUnavailableError);
  });

  it('treats an objects block of another shape as empty, not as a crash in the adapter', () => {
    // The blob is cast, not validated: a non-array used to reach `.map` in the adapter and
    // throw "map is not a function" — a crash that names nothing useful.
    const oddObjects =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: { objects: {} } } }) +
      '</script>';

    expect(extractPage(oddObjects).objects).toEqual([]);
  });

  it('treats pageProps without an objects array as empty — realt renders some zero-result pages so', () => {
    const noObjects =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: { apolloState: {} } } }) +
      '</script>';

    expect(extractPage(noObjects)).toEqual({ objects: [], pagination: null });
  });
});

describe('mapObject', () => {
  it('maps fields, picks USD/BYN from priceRates, builds the object link', () => {
    const [obj] = extractPage(fixture).objects;

    const listing = mapObject(obj, 'sale-plots');

    expect(listing).toMatchObject({
      externalId: '4152736',
      link: 'https://realt.by/sale-plots/object/4152736/',
      priceUsd: 7000,
      priceByn: 19401,
      address: 'Кировск Старосельская ул. 14',
    });
  });

  it('falls back to town + street when the title is empty', () => {
    const [obj] = extractPage(fixture).objects;

    expect(mapObject(obj, 'sale-plots').title).toBe('Кировск, Старосельская ул.');
  });

  it('keeps fractional sotki unrounded — 9.84 is the plot, 10 is not', () => {
    const [plot] = extractPage(fixture).objects;

    expect(mapObject(plot, 'sale-plots').details).toEqual([
      { label: 'Участок', value: '9.84 сот.' },
    ]);
  });

  it('fills the building fields a house has, in card order', () => {
    const house = extractPage(fixture).objects[2];

    const listing = mapObject(house, 'sale-cottages');

    expect(listing.seller).toBe('Агентство');
    expect(listing.details).toEqual([
      { label: 'Площадь', value: '70.1 м²' },
      { label: 'Жилая', value: '45 м²' },
      { label: 'Участок', value: '8 сот.' },
      { label: 'Год постройки', value: '1979' },
    ]);
    // realt publishes no coordinates, so its cards get no map pin.
    expect(listing.coordinates).toBeUndefined();
  });

  it('leaves the seller absent when the object carries no contact', () => {
    const noContact = extractPage(fixture).objects[1];

    expect(mapObject(noContact, 'sale-plots').seller).toBeUndefined();
  });

  it('drops the levels line when it just repeats the storeys', () => {
    const base = { code: 1, updatedAt: '2026-01-01T00:00:00+03:00', storeys: 2 };

    expect(mapObject({ ...base, levels: 2 }, 'sale-cottages').details).toEqual([
      { label: 'Этажей', value: '2' },
    ]);
    expect(mapObject({ ...base, levels: 1 }, 'sale-cottages').details).toEqual([
      { label: 'Этажей', value: '2' },
      { label: 'Уровней', value: '1' },
    ]);
  });
});
