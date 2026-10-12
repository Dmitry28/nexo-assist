import { makeListing } from '@/__tests__/helpers/listing';

import {
  MIN_PRICE_CHANGE_PERCENT,
  asSnapshot,
  hasPriceChanged,
  replacesSnapshot,
  toSnapshot,
} from '../price-change';

// Cases below with observed numbers were measured by the prototype on live kufar/realt/prometr data.
describe('hasPriceChanged', () => {
  it.each([
    [
      'an unchanged price',
      { priceByn: 300_000, priceUsd: 100_000 },
      { priceByn: 300_000, priceUsd: 100_000 },
    ],
    [
      'drift with a USD-priced listing',
      { priceByn: 300_000, priceUsd: 100_000 },
      { priceByn: 318_000, priceUsd: 100_000 },
    ],
    [
      'drift with a BYN-priced listing',
      { priceByn: 300_000, priceUsd: 100_000 },
      { priceByn: 300_000, priceUsd: 94_720 },
    ],
    [
      'third-currency drift, opposite directions',
      { priceByn: 300_000, priceUsd: 94_152 },
      { priceByn: 302_070, priceUsd: 91_723 },
    ],
    [
      'a same-direction move under the floor',
      { priceByn: 300_000, priceUsd: 100_000 },
      { priceByn: 295_500, priceUsd: 98_600 },
    ],
    ['BYN-only drift (prometr, +0.08 %)', { priceByn: 521_591 }, { priceByn: 522_004 }],
    ['a USD-only move under the floor', { priceUsd: 100_000 }, { priceUsd: 99_000 }],
    ['a price that vanished', { priceByn: 300_000, priceUsd: 100_000 }, {}],
    ['a listing that never had a price', {}, {}],
    ['zero standing for no price', { priceByn: 0, priceUsd: 0 }, {}],
    ['a currency swap with nothing comparable', { priceByn: 300_000 }, { priceUsd: 100_000 }],
  ])('ignores %s', (_, before, after) => {
    expect(hasPriceChanged(before, after)).toBe(false);
  });

  it.each([
    [
      'a cut moving both figures (-19.7 % / -19.5 %)',
      { priceByn: 449_040, priceUsd: 149_680 },
      { priceByn: 361_300, priceUsd: 120_139 },
    ],
    [
      'an increase moving both figures',
      { priceByn: 196_200, priceUsd: 65_400 },
      { priceByn: 229_870, priceUsd: 75_500 },
    ],
    ['a BYN-only cut past the floor', { priceByn: 522_937 }, { priceByn: 510_000 }],
    ['a USD-only cut past the floor', { priceUsd: 100_000 }, { priceUsd: 95_000 }],
    ['a price that appeared («договорная» → priced)', {}, { priceByn: 300_000, priceUsd: 100_000 }],
  ])('reports %s', (_, before, after) => {
    expect(hasPriceChanged(before, after)).toBe(true);
  });

  it('reports a cut of exactly the floor', () => {
    const factor = 1 - MIN_PRICE_CHANGE_PERCENT / 100;
    expect(
      hasPriceChanged(
        { priceByn: 300_000, priceUsd: 100_000 },
        { priceByn: 300_000 * factor, priceUsd: 100_000 * factor },
      ),
    ).toBe(true);
  });
});

describe('replacesSnapshot', () => {
  it('keeps the old snapshot while the price is missing, so its return is no change', () => {
    expect(replacesSnapshot({ priceByn: 100 }, {})).toBe(false);
  });

  it.each([
    [{ priceByn: 100 }, { priceByn: 101 }],
    [{}, {}],
    [{}, { priceUsd: 5 }],
  ])('replaces it otherwise (%p → %p)', (before, after) => {
    expect(replacesSnapshot(before, after)).toBe(true);
  });
});

describe('asSnapshot', () => {
  it('reads back what toSnapshot stored', () => {
    const snapshot = toSnapshot(makeListing(1, { priceByn: 10, priceUsd: 3, description: 'x' }));
    expect(asSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({
      link: 'https://re.kufar.by/vi/1',
      title: 't1',
      priceByn: 10,
      priceUsd: 3,
    });
  });

  it.each([null, 'x', {}, { link: 'l' }, { link: 'l', title: 't', priceByn: '10' }])(
    'treats %p as no snapshot',
    (value) => {
      expect(asSnapshot(value)).toBeUndefined();
    },
  );
});
