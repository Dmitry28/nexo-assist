import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { SEARCH_PATH, configUrl, parsePage } from '../gridom.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/gridom-search.json'), 'utf8');
const ctx = { url: 'https://gridom.by/pogorany', page: 1, now: new Date(), sent: 0 };

describe('gridom', () => {
  it('reads the widget’s data from its JSON endpoint', () => {
    expect(configUrl('https://gridom.by/pogorany/')).toBe(
      'https://gridom.by/api/public/pogorany/config',
    );
  });

  // On sale = free and «shared» (a share deal). Reserved and sold are left out: a reserved one
  // delivered now would never be announced when it comes back on sale.
  it('lists only units on sale, a share deal marked as such', () => {
    const { listings } = parsePage(fixture, ctx);

    expect(listings.map((l) => l.externalId)).toEqual([
      'u1787209341586',
      'umtrccz3w9e3a',
      'umt2orv7x5ftg',
    ]);
    expect(listings[2].details).toContainEqual({ label: 'Сделка', value: 'долевое строительство' });
  });

  it.each([
    ['/pogorany', true],
    ['/api', false],
    ['/present', false],
    ['/pogorany/x', false],
  ])('treats %s as a developer page: %p', (path, expected) => {
    expect(SEARCH_PATH.test(path)).toBe(expected);
  });

  it('maps a unit: price, area, rooms, encoded photos and the project', () => {
    const [unit] = parsePage(fixture, ctx).listings;

    expect(unit).toMatchObject({
      link: 'https://gridom.by/pogorany?unit=u1787209341586',
      title: 'Квартира, № 1, 91 м²',
      priceByn: 321684,
      address: 'ЖК "Погораны"',
    });
    expect(unit.images[0]).toMatch(/^https:\/\/gridom\.by\/data\/pogorany\/images\/[\x21-\x7e]+$/);
  });

  it('drops an entry that is no unit at all', () => {
    const json = JSON.stringify({ units: [null, 7, { id: 'a', status: 'free' }] });

    expect(parsePage(json, ctx).listings.map((l) => l.externalId)).toEqual(['a']);
  });

  it('throws on a body that is not the config JSON', () => {
    expect(() => parsePage('<html>bot wall</html>', ctx)).toThrow(SourceUnavailableError);
  });
});
