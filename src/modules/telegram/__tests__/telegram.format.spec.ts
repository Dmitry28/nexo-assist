import { makeListing as listing } from '@/__tests__/helpers/listing';

import {
  DIGEST_LIMIT,
  MAX_LINE_CHARS,
  formatCurrentListings,
  newListingsDigest,
} from '../telegram.format';

describe('newListingsDigest', () => {
  it('shows the count header and listing fields', () => {
    const { text } = newListingsDigest([listing(1, { priceUsd: 5000 })]);

    expect(text).toContain('🆕 Новых объявлений: 1');
    expect(text).toContain('$5000');
    expect(text).toContain('https://re.kufar.by/vi/1');
  });

  it('caps the shown items and returns exactly that slice as delivered', () => {
    const many = Array.from({ length: DIGEST_LIMIT + 2 }, (_, i) => listing(i + 1));

    const { text, delivered } = newListingsDigest(many);

    expect(text).toContain(`🆕 Новых объявлений: ${DIGEST_LIMIT + 2}`);
    expect(text).toContain('…и ещё 2');
    expect(delivered).toHaveLength(DIGEST_LIMIT);
    expect(delivered[0].externalId).toBe('1');
  });

  it('truncates a pathological title but keeps the price and link intact', () => {
    const link = 'https://re.kufar.by/vi/1';

    const { text, delivered } = newListingsDigest([
      listing(1, { title: 't'.repeat(5000), priceUsd: 5000, link }),
    ]);

    // A delivered item is marked seen for good, so truncating the assembled line — which would
    // cut the trailing link — loses the listing silently.
    const item = text.split('\n\n')[1];
    expect(item.split('\n')).toEqual([expect.stringMatching(/^t+…$/), '$5000', link]);
    expect(item.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(delivered).toHaveLength(1);
  });

  it.each(['', 'x'])('does not split an emoji when truncating the title (prefix %p)', (prefix) => {
    // The prefix shifts where the cut lands; one parity falls inside a surrogate pair, which
    // an unguarded slice would leave half of.
    const { text } = newListingsDigest([listing(1, { title: `${prefix}${'🏠'.repeat(400)}` })]);

    // A high surrogate not followed by a low one is half an emoji — renders as "�".
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(text).toContain('https://re.kufar.by/vi/1');
  });

  it('clamps a pathological link too — a single huge link still delivers one item', () => {
    const { text, delivered } = newListingsDigest([
      listing(1, { link: `https://x.by/${'x'.repeat(5000)}` }),
    ]);

    expect(delivered).toHaveLength(1);
    expect(text.length).toBeLessThan(4096);
  });

  it('caps by characters too — oversized items fold into the "more" footer', () => {
    const longLinks = Array.from({ length: 10 }, (_, i) =>
      listing(i + 1, { link: `https://re.kufar.by/vi/${'x'.repeat(400)}${i}` }),
    );

    const { text, delivered } = newListingsDigest(longLinks);

    expect(text.length).toBeLessThan(4096);
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.length).toBeLessThan(10);
    expect(text).toContain(`…и ещё ${10 - delivered.length}`);
  });

  it('falls back through the price options', () => {
    expect(newListingsDigest([listing(1, { priceByn: 100 })]).text).toContain('100 BYN');
    expect(newListingsDigest([listing(1)]).text).toContain('цена не указана');
  });
});

describe('formatCurrentListings', () => {
  it('uses a "current" header', () => {
    expect(formatCurrentListings([listing(1)])).toContain('📋 Объявлений сейчас: 1');
  });
});
