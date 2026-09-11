import { makeListing as listing } from '@/__tests__/helpers/listing';

import {
  BOT_COMMANDS,
  DIGEST_LIMIT,
  HELP_MESSAGE,
  MAX_LINE_CHARS,
  formatCurrentListings,
  tailBatches,
} from '../telegram.format';

// The digest groups thousands like the cards do (U+00A0), so the expectations spell it out.
const PRICE_5000 = '$5\u00A0000';

describe('tailBatches', () => {
  it('shows the count header and listing fields', () => {
    const [{ text }] = tailBatches([listing(1, { priceUsd: 5000 })]);

    expect(text).toContain('🆕 Ещё объявлений: 1');
    expect(text).toContain(PRICE_5000);
    expect(text).toContain('https://re.kufar.by/vi/1');
  });

  it('splits into messages instead of dropping the overflow', () => {
    const many = Array.from({ length: DIGEST_LIMIT + 2 }, (_, i) => listing(i + 1));

    const batches = tailBatches(many);

    expect(batches).toHaveLength(2);
    expect(batches[0].text).toContain(`🆕 Ещё объявлений: ${DIGEST_LIMIT + 2} (1/2)`);
    expect(batches[1].listings).toHaveLength(2);
    // Every listing ends up in exactly one message — nothing silently lost.
    expect(batches.flatMap((b) => b.listings.map((l) => l.externalId))).toEqual(
      many.map((l) => l.externalId),
    );
  });

  // Nothing is deferred any more: a deferred tail could age out of the source's page window
  // and be lost, so the whole run goes out in the run.
  it('carries every listing and promises nothing for later', () => {
    const many = Array.from({ length: 120 }, (_, i) => listing(i + 1));

    const batches = tailBatches(many);

    expect(batches.flatMap((b) => b.listings)).toHaveLength(120);
    expect(batches.map((b) => b.text).join()).not.toContain('в следующую проверку');
  });

  it('leaves a single message unnumbered', () => {
    const [{ text }] = tailBatches([listing(1)]);

    expect(text).toContain('🆕 Ещё объявлений: 1\n');
    expect(text).not.toContain('(1/1)');
  });

  it('truncates a pathological title but keeps the price and link intact', () => {
    const link = 'https://re.kufar.by/vi/1';

    const [{ text, listings: delivered }] = tailBatches([
      listing(1, { title: 't'.repeat(5000), priceUsd: 5000, link }),
    ]);

    // A delivered item is marked seen for good, so truncating the assembled line — which would
    // cut the trailing link — loses the listing silently.
    const item = text.split('\n\n')[1];
    expect(item.split('\n')).toEqual([expect.stringMatching(/^t+…$/), PRICE_5000, link]);
    expect(item.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(delivered).toHaveLength(1);
  });

  it.each(['', 'x'])('does not split an emoji when truncating the title (prefix %p)', (prefix) => {
    // The prefix shifts where the cut lands; one parity falls inside a surrogate pair, which
    // an unguarded slice would leave half of.
    const [{ text }] = tailBatches([listing(1, { title: `${prefix}${'🏠'.repeat(400)}` })]);

    // A high surrogate not followed by a low one is half an emoji — renders as "�".
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(text).toContain('https://re.kufar.by/vi/1');
  });

  it('clamps a pathological link too — a single huge link still delivers one item', () => {
    const [{ text, listings: delivered }] = tailBatches([
      listing(1, { link: `https://x.by/${'x'.repeat(5000)}` }),
    ]);

    expect(delivered).toHaveLength(1);
    expect(text.length).toBeLessThan(4096);
  });

  it('keeps the link whole when the tail alone fills the line — no ellipsis budget left', () => {
    // A link long enough to leave the title zero budget: tail = '\n' + price + '\n' + link is
    // exactly MAX_LINE_CHARS, so truncate() is asked for a non-positive budget and must yield
    // nothing. Returning '…' instead would push the line over the cap and cut the link off.
    const linkLength = MAX_LINE_CHARS - `\n${PRICE_5000}\n`.length;
    const link = `https://x.by/${'x'.repeat(linkLength - 'https://x.by/'.length)}`;
    const tailLength = `\n${PRICE_5000}\n${link}`.length;
    expect(tailLength).toBe(MAX_LINE_CHARS);

    const [{ text }] = tailBatches([listing(1, { title: 'a title', priceUsd: 5000, link })]);

    expect(text).toContain(link);
  });

  it('splits by characters too, and every message stays sendable', () => {
    const longLinks = Array.from({ length: 10 }, (_, i) =>
      listing(i + 1, { link: `https://re.kufar.by/vi/${'x'.repeat(400)}${i}` }),
    );

    const batches = tailBatches(longLinks);

    expect(batches.length).toBeGreaterThan(1); // char budget, not the item count, forced the split
    for (const batch of batches) expect(batch.text.length).toBeLessThan(4096);
    expect(batches.flatMap((b) => b.listings)).toHaveLength(10);
  });

  it('falls back through the price options', () => {
    expect(tailBatches([listing(1, { priceByn: 100 })])[0].text).toContain('100 BYN');
    expect(tailBatches([listing(1)])[0].text).toContain('цена не указана');
  });
});

describe('formatCurrentListings', () => {
  it('uses a "current" header', () => {
    expect(formatCurrentListings([listing(1)])).toContain('📋 Объявлений сейчас: 1');
  });

  it('states the empty case instead of an empty digest', () => {
    expect(formatCurrentListings([])).toBe('Сейчас объявлений нет.');
  });
});

describe('HELP_MESSAGE', () => {
  it('lists every menu command, so the menu and the help text cannot drift apart', () => {
    for (const { command } of BOT_COMMANDS) expect(HELP_MESSAGE).toContain(`/${command} —`);
  });

  it('says what is stored and how to have it deleted', () => {
    expect(HELP_MESSAGE).toContain('telegram-id');
    expect(HELP_MESSAGE).toContain('удалить');
  });
});
