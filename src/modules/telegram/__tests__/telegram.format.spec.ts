import { makeListing as listing } from '@/__tests__/helpers/listing';

import { DIGEST_LIMIT, formatCurrentListings, newListingsDigest } from '../telegram.format';

describe('newListingsDigest', () => {
  it('shows the count header and listing fields', () => {
    const { text } = newListingsDigest([listing(1, { priceUsd: 5000 })]);

    expect(text).toContain('🆕 1 new');
    expect(text).toContain('$5000');
    expect(text).toContain('https://re.kufar.by/vi/1');
  });

  it('caps the shown items and returns exactly that slice as delivered', () => {
    const many = Array.from({ length: DIGEST_LIMIT + 2 }, (_, i) => listing(i + 1));

    const { text, delivered } = newListingsDigest(many);

    expect(text).toContain(`🆕 ${DIGEST_LIMIT + 2} new`);
    expect(text).toContain('…and 2 more');
    expect(delivered).toHaveLength(DIGEST_LIMIT);
    expect(delivered[0].externalId).toBe('1');
  });

  it('caps by characters too — a few huge titles must not break the 4096-char limit', () => {
    const huge = Array.from({ length: 5 }, (_, i) => listing(i + 1, { title: 't'.repeat(1500) }));

    const { text, delivered } = newListingsDigest(huge);

    expect(text.length).toBeLessThan(4096);
    expect(delivered.length).toBeLessThan(5);
    expect(text).toContain(`…and ${5 - delivered.length} more`);
  });

  it('falls back through the price options', () => {
    expect(newListingsDigest([listing(1, { priceByn: 100 })]).text).toContain('100 BYN');
    expect(newListingsDigest([listing(1)]).text).toContain('price n/a');
  });
});

describe('formatCurrentListings', () => {
  it('uses a "current" header', () => {
    expect(formatCurrentListings([listing(1)])).toContain('📋 1 current');
  });
});
