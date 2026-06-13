import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractObjects, mapObject } from './realt.parser';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/realt-search.html'), 'utf8');

describe('extractObjects', () => {
  it('reads objects from the __NEXT_DATA__ JSON', () => {
    const objects = extractObjects(fixture);

    expect(objects).toHaveLength(2);
    expect(objects[0].code).toBe(4152736);
  });

  it('returns [] when __NEXT_DATA__ is absent', () => {
    expect(extractObjects('<html>no data</html>')).toEqual([]);
  });
});

describe('mapObject', () => {
  it('maps fields, picks USD/BYN from priceRates, builds the object link', () => {
    const [obj] = extractObjects(fixture);

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
    const [obj] = extractObjects(fixture);

    expect(mapObject(obj, 'sale-plots').title).toBe('Кировск, Старосельская ул.');
  });
});
