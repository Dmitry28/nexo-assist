import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseNextData } from '../../scraping/next-data';
import { SourceUnavailableError } from '../../source-adapter';
import { extractPage, mapRentalObject } from '../kufar-travel.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-travel-search.html'), 'utf8');

const page = (listing: unknown): string =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { initialState: { listing } },
  })}</script>`;

describe('extractPage', () => {
  // The fixture's hotel is a live promo slot: listed 2026-09-22 between two flats of 2026-10-06.
  it('reads the rental objects, minus a hotel spliced in out of order', () => {
    const { objects, hasMore } = extractPage(fixture);

    expect(objects.map((o) => o.adId)).toEqual([1079283982, 1054122264]);
    expect(hasMore).toBe(true);
  });

  it('keeps a hotel listed inside the page span — a new hotel still arrives', () => {
    const { objects } = extractPage(
      page({
        rentalObjects: [
          { adId: 1, listTime: '2026-10-06T10:00:00Z' },
          { adId: 2, isHotel: true, listTime: '2026-10-06T09:00:00Z' },
          { adId: 3, listTime: '2026-10-06T08:00:00Z' },
        ],
      }),
    );

    expect(objects.map((o) => o.adId)).toEqual([1, 2, 3]);
  });

  it.each([
    [{ page: 12, pages: 13 }, true],
    [{ page: 13, pages: 13 }, false],
    [{ page: 1, pages: 0 }, false], // zero-result search (measured)
    [{ page: 'x', pages: 13 }, false],
    [undefined, false],
  ])('paginator %p → hasMore %p', (bookingPaginator, expected) => {
    expect(extractPage(page({ rentalObjects: [], bookingPaginator })).hasMore).toBe(expected);
  });

  it('drops an object without an id, and fails a page where none has one', () => {
    const at = '2026-10-06T10:00:00Z';
    const objects = (items: unknown[]) => extractPage(page({ rentalObjects: items })).objects;

    expect(
      objects([
        { adId: 1, listTime: at },
        { id: 'x', listTime: at },
      ]),
    ).toHaveLength(1);
    expect(() => objects([{ id: 'x', listTime: at }])).toThrow(SourceUnavailableError);
  });

  it('throws when the page carries no __NEXT_DATA__ at all', () => {
    expect(() => extractPage('<html>bot wall</html>')).toThrow(SourceUnavailableError);
  });

  // Measured: a zero-result search still carries `rentalObjects: []`, so a missing key is not one.
  it('throws when rentalObjects is missing — a layout change must not read as an empty search', () => {
    expect(() => extractPage(page({ ads: [] }))).toThrow(SourceUnavailableError);
  });
});

describe('mapRentalObject', () => {
  // Straight from the fixture's JSON — extractPage would drop the promoted hotel.
  const raw = parseNextData(fixture) as {
    props: {
      initialState: { listing: { rentalObjects: Parameters<typeof mapRentalObject>[0][] } };
    };
  };
  const [flat, hotel, noFloor] = raw.props.initialState.listing.rentalObjects.map(mapRentalObject);

  it('maps a flat — per-night price in both currencies, a stable link, the area from `size`', () => {
    expect(flat).toMatchObject({
      externalId: '1079283982',
      link: 'https://travel.kufar.by/hotel/1079283982',
      priceByn: 250,
      priceUsd: 82,
      coordinates: { lat: 53.682351, lon: 23.836931 },
    });
    expect(flat.images).toHaveLength(2);
    expect(flat.images[0]).toMatch(/^https:\/\/rms\.kufar\.by\/v1\/gallery\//);
    // `area` in the payload is a district code (9 on every Grodno object); the m² is `size`.
    expect(flat.details).toEqual([
      { label: 'Тип', value: 'Квартира' },
      { label: 'Комнат', value: '2' },
      { label: 'Площадь', value: '65 м²' },
      { label: 'Этаж', value: '1' },
      { label: 'Гостей', value: '4' },
      { label: 'Рейтинг', value: '5.0 (8 отз.)' },
    ]);
  });

  it('cuts the full description to a preview', () => {
    expect(flat.description).toHaveLength(151);
    expect(flat.description?.endsWith('…')).toBe(true);
  });

  // Every hotel measured reads size 1, rooms 1, persons 2 and rating 0.0 of 0 — defaults.
  it("shows a hotel's type, not its placeholder unit facts or an empty rating", () => {
    expect(hotel.details).toEqual([{ label: 'Тип', value: 'Отель' }]);
  });

  it('leaves out a field the object does not carry', () => {
    expect(noFloor.details.map((d) => d.label)).not.toContain('Этаж');
  });
});
