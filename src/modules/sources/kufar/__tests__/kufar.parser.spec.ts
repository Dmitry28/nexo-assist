import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('throws when __NEXT_DATA__ is absent — a bot-wall must not read as an empty search', () => {
    expect(() => extractPage('<html><body>no data</body></html>')).toThrow('__NEXT_DATA__');
  });

  it('throws on malformed JSON', () => {
    const broken = '<script id="__NEXT_DATA__" type="application/json">{ not json </script>';

    expect(() => extractPage(broken)).toThrow('__NEXT_DATA__');
  });

  it('throws when the listing state is missing — a layout change must not read as empty', () => {
    const noAds =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({ props: { pageProps: {} } }) +
      '</script>';

    expect(() => extractPage(noAds)).toThrow('listing.ads');
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
    expect(listing.images[0]).toBe(
      'https://rms.kufar.by/v1/list_thumbs_2x/adim1/ab2e0c37-703d-4580-a1a8-ebf7228caaa3.jpg',
    );
  });

  it('omits price when the raw value is zero or missing', () => {
    const listing = mapAd({ ad_id: 1, subject: 'x', list_time: '2026-01-01T00:00:00Z' });

    expect(listing.priceByn).toBeUndefined();
    expect(listing.images).toEqual([]);
  });
});
