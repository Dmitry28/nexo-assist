import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractAds, mapAd } from './kufar.parser';

const fixture = readFileSync(join(__dirname, '__tests__/fixtures/kufar-search.html'), 'utf8');

describe('extractAds', () => {
  it('reads ads from the __NEXT_DATA__ JSON', () => {
    const ads = extractAds(fixture);

    expect(ads).toHaveLength(2);
    expect(ads[0].ad_id).toBe(1069720654);
  });

  it('returns [] when __NEXT_DATA__ is absent', () => {
    expect(extractAds('<html><body>no data</body></html>')).toEqual([]);
  });

  it('returns [] on malformed JSON', () => {
    const broken = '<script id="__NEXT_DATA__" type="application/json">{ not json </script>';

    expect(extractAds(broken)).toEqual([]);
  });
});

describe('mapAd', () => {
  it('maps the core fields and converts price from 1/100 units', () => {
    const [ad] = extractAds(fixture);

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
