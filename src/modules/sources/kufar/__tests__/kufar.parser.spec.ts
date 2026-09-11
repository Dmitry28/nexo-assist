import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UNTITLED_LISTING, SourceUnavailableError } from '@/modules/sources/source-adapter';

import { extractPage, mapAd } from '../kufar.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/kufar-search.html'), 'utf8');

describe('extractPage', () => {
  it('reads ads from the __NEXT_DATA__ JSON (no next on the last page)', () => {
    const { ads, nextCursor } = extractPage(fixture);

    expect(ads).toHaveLength(2);
    expect(ads[0].ad_id).toBe(1069720654);
    expect(nextCursor).toBeNull();
  });

  it('reads the next-page cursor token when present', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({
        props: {
          pageProps: {
            initialState: {
              listing: {
                ads: [],
                pagination: [
                  { label: 'self', token: 't0' },
                  { label: 'next', token: 't1' },
                ],
              },
            },
          },
        },
      }) +
      '</script>';

    expect(extractPage(html).nextCursor).toBe('t1');
  });

  // The type is asserted, not just the message: Sentry derives `kind` from it, so a plain Error
  // here would bill a bot-wall as our defect (see the SourceUnavailableError docblock).
  it('throws when __NEXT_DATA__ is absent — a bot-wall must not read as an empty search', () => {
    const thrown = () => extractPage('<html><body>no data</body></html>');

    expect(thrown).toThrow('__NEXT_DATA__');
    expect(thrown).toThrow(SourceUnavailableError);
  });

  it('throws on malformed JSON', () => {
    const broken = '<script id="__NEXT_DATA__" type="application/json">{ not json </script>';

    expect(() => extractPage(broken)).toThrow('__NEXT_DATA__');
  });

  it('treats a pagination block of another shape as "no next page"', () => {
    // The blob is cast, not validated: an object where an array is expected used to throw
    // "find is not a function" — a crash that names nothing useful.
    const oddPagination =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({
        props: { pageProps: { initialState: { listing: { ads: [], pagination: {} } } } },
      }) +
      '</script>';

    expect(extractPage(oddPagination)).toEqual({ ads: [], nextCursor: null });
  });

  it('throws when the listing state is missing — a layout change must not read as empty', () => {
    const noAds =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: {} } }) +
      '</script>';

    expect(() => extractPage(noAds)).toThrow('listing.ads');
    expect(() => extractPage(noAds)).toThrow(SourceUnavailableError);
  });
});

describe('mapAd', () => {
  it('maps the core fields and converts price from 1/100 units', () => {
    const [ad] = extractPage(fixture).ads;

    const listing = mapAd(ad);

    expect(listing).toMatchObject({
      externalId: '1069720654',
      link: 'https://re.kufar.by/vi/1069720654',
      priceByn: 13850,
      priceUsd: 5000,
      address: 'Гурского ул, 28, Минск',
    });
    // The gallery variant, not the list thumbnail: a card shows the photo full width.
    expect(listing.images[0]).toBe(
      'https://rms.kufar.by/v1/gallery/adim1/ab2e0c37-703d-4580-a1a8-ebf7228caaa3.jpg',
    );
  });

  it('fills the card fields: seller, labelled details in order, and the map pin', () => {
    const [ad] = extractPage(fixture).ads;

    const listing = mapAd(ad);

    expect(listing.seller).toBe('Продавец');
    expect(listing.details).toEqual([
      { label: 'Тип', value: 'Металлический' },
      { label: 'Площадь', value: '18 м²' },
      // A single amenity key holding a list of labels collapses into one line.
      { label: 'Удобства', value: 'Свет, Охрана' },
    ]);
    // Verified live: kufar stores the pair longitude-first, so this must NOT be 27.53 lat.
    expect(listing.coordinates).toEqual({ lat: 53.8795, lon: 27.5321 });
  });

  it('names a parking space from garage_parking_type, which has no garage_type', () => {
    const ad = extractPage(fixture).ads[1];

    const listing = mapAd(ad);

    expect(listing.details[0]).toEqual({ label: 'Тип', value: 'Машиноместо' });
    expect(listing.coordinates).toBeUndefined();
  });

  it('gives each facility its own label — «Удобства: Центральное» names nothing', () => {
    const listing = mapAd({
      ad_id: 1,
      list_time: '2026-01-01T00:00:00Z',
      ad_parameters: [
        { p: 're_heating', v: '10', vl: 'Электрическое' },
        { p: 're_water', v: '15', vl: 'Центральная' },
        { p: 're_property_rights', v: '1', vl: 'Частная собственность' },
      ],
    });

    expect(listing.details).toEqual([
      { label: 'Отопление', value: 'Электрическое' },
      { label: 'Вода', value: 'Центральная' },
      { label: 'Права', value: 'Частная собственность' },
    ]);
  });

  // kufar cuts `body_short` at 150 characters, mid-word and with nothing to show for it.
  it('marks a description kufar itself cut short', () => {
    const cut = 'я'.repeat(150);

    expect(mapAd({ ad_id: 1, list_time: 't', body_short: cut }).description).toBe(`${cut}…`);
    expect(mapAd({ ad_id: 1, list_time: 't', body_short: 'коротко' }).description).toBe('коротко');
  });

  it('reads the label, never the internal code, for a dictionary field', () => {
    const listing = mapAd({
      ad_id: 1,
      list_time: '2026-01-01T00:00:00Z',
      ad_parameters: [{ p: 'house_type_for_sell', v: '25', vl: 'Таунхаус' }],
    });

    expect(listing.details).toEqual([{ label: 'Тип', value: 'Таунхаус' }]);
  });

  it('takes the plot area from size_area and the building area from size', () => {
    // Live shapes: a house sets both (m² and sotki), a plot sets only size_area.
    const house = mapAd({
      ad_id: 1,
      list_time: '2026-01-01T00:00:00Z',
      ad_parameters: [
        { p: 'size', v: 98 },
        { p: 'size_area', v: 2 },
        { p: 'rooms', v: '4' },
        { p: 'year_built', v: 2024 },
      ],
    });

    expect(house.details).toEqual([
      { label: 'Площадь', value: '98 м²' },
      { label: 'Участок', value: '2 сот.' },
      { label: 'Комнат', value: '4' },
      { label: 'Год постройки', value: '2024' },
    ]);
  });

  it.each([
    ['malformed', 'not a pair'],
    ['half-filled', [27.53]],
    ['out of range', [27.53, 953.9]],
    // A zeroed pair is an unfilled field, not a spot in the Atlantic.
    ['zeroed', [0, 0]],
  ])('drops %s coordinates rather than pinning the wrong place', (_label, value) => {
    const listing = mapAd({
      ad_id: 1,
      list_time: '2026-01-01T00:00:00Z',
      ad_parameters: [{ p: 'coordinates', v: value }],
    });

    expect(listing.coordinates).toBeUndefined();
  });

  it('omits price when the raw value is zero or missing', () => {
    const listing = mapAd({ ad_id: 1, subject: 'x', list_time: '2026-01-01T00:00:00Z' });

    expect(listing.priceByn).toBeUndefined();
    expect(listing.images).toEqual([]);
  });

  it('omits a price that rounds down to zero rather than showing "0 BYN"', () => {
    // Kufar's units are 1/100, so anything under 50 is not a price the user should see.
    const listing = mapAd({ ad_id: 1, price_byn: '30', list_time: '2026-01-01T00:00:00Z' });

    expect(listing.priceByn).toBeUndefined();
  });

  it.each([
    ['absent', undefined],
    ['blank', '   '],
  ])('labels an ad whose subject is %s instead of returning no title', (_label, subject) => {
    // formatOne reads `.length` off the title, so an absent one takes down the whole
    // delivery — and the subscription then looks dead. A label degrades; undefined crashes.
    const listing = mapAd({ ad_id: 1, subject, list_time: '2026-01-01T00:00:00Z' });

    expect(listing.title).toBe(UNTITLED_LISTING);
  });
});
