import { makeListing as listing } from '@/__tests__/helpers/listing';

import { formatCurrentListings, formatNewListings } from './telegram.format';

describe('formatNewListings', () => {
  it('shows the count header and listing fields', () => {
    const message = formatNewListings([listing(1, { priceUsd: 5000 })]);

    expect(message).toContain('🆕 1 new');
    expect(message).toContain('$5000');
    expect(message).toContain('https://re.kufar.by/vi/1');
  });

  it('caps at 10 and appends a "+N more" footer', () => {
    const many = Array.from({ length: 12 }, (_, i) => listing(i + 1));

    const message = formatNewListings(many);

    expect(message).toContain('🆕 12 new');
    expect(message).toContain('…and 2 more');
  });

  it('falls back through the price options', () => {
    expect(formatNewListings([listing(1, { priceByn: 100 })])).toContain('100 BYN');
    expect(formatNewListings([listing(1)])).toContain('price n/a');
  });
});

describe('formatCurrentListings', () => {
  it('uses a "current" header', () => {
    expect(formatCurrentListings([listing(1)])).toContain('📋 1 current');
  });
});
