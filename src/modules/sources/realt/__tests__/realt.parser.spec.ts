import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractPage, mapObject } from '../realt.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/realt-search.html'), 'utf8');

describe('extractPage', () => {
  it('reads objects and the pagination block', () => {
    const { objects, pagination } = extractPage(fixture);

    expect(objects).toHaveLength(2);
    expect(objects[0].code).toBe(4152736);
    expect(pagination?.totalCount).toBe(2);
  });

  it('throws when __NEXT_DATA__ is absent — a bot-wall must not read as an empty search', () => {
    expect(() => extractPage('<html>no data</html>')).toThrow('__NEXT_DATA__');
  });

  it('treats a page without an objects array as empty — realt renders some zero-result pages so', () => {
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
});
