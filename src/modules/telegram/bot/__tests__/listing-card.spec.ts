import { makeListing } from '@/__tests__/helpers/listing';

import {
  CAPTION_LIMIT_CHARS,
  MESSAGE_LIMIT_CHARS,
  escapeHtml,
  formatListTime,
  formatPrice,
  listingCard,
} from '../listing-card';

const card = (overrides = {}, limit = MESSAGE_LIMIT_CHARS): string =>
  listingCard(makeListing(1, overrides), limit);

describe('listingCard', () => {
  it('lays out every block the sources give us', () => {
    const text = card({
      title: 'Дом в Гродно',
      description: 'кирпичный, с участком',
      address: 'Гродно, Калиновского 14',
      priceByn: 96921,
      priceUsd: 33000,
      seller: 'Агентство',
      details: [
        { label: 'Площадь', value: '70.1 м²' },
        { label: 'Участок', value: '8 сот.' },
      ],
    });

    expect(text).toContain('🏠 <b>Дом в Гродно</b>');
    expect(text).toContain('<i>кирпичный, с участком</i>');
    expect(text).toContain('📍 Гродно, Калиновского 14');
    expect(text).toContain('Площадь: 70.1 м²');
    expect(text).toContain('Участок: 8 сот.');
    expect(text).toContain('👤 Агентство');
    expect(text).toContain('<a href="https://re.kufar.by/vi/1">🔗 Подробнее</a>');
  });

  it('omits the blocks a source left empty instead of printing empty lines', () => {
    const text = card();

    expect(text).not.toContain('📍');
    expect(text).not.toContain('👤');
    expect(text).not.toContain('<i>');
  });

  // A stray `<` in a scraped title makes Telegram reject the message; nothing is marked seen
  // until it is delivered, so the same card would be rebuilt and rejected on every run.
  it('escapes scraped text so one bad character cannot block a subscription', () => {
    const text = card({
      title: 'Дом <b>дёшево</b> & быстро',
      description: '5 < 10',
      address: 'ул. "Тихая"',
      details: [{ label: 'Тип', value: '<Дача>' }],
    });

    expect(text).toContain('🏠 <b>Дом &lt;b&gt;дёшево&lt;/b&gt; &amp; быстро</b>');
    expect(text).toContain('<i>5 &lt; 10</i>');
    expect(text).toContain('📍 ул. &quot;Тихая&quot;');
    expect(text).toContain('Тип: &lt;Дача&gt;');
  });

  it('escapes the link too — it comes from the source, not from us', () => {
    const text = card({ link: 'https://re.kufar.by/vi/1?a=1&b=2' });

    expect(text).toContain('<a href="https://re.kufar.by/vi/1?a=1&amp;b=2">');
  });

  describe('when it does not fit the limit', () => {
    const long = (n: number): string => 'я'.repeat(n);

    it('trims the description first and keeps the link', () => {
      const text = card({ description: long(2000) }, CAPTION_LIMIT_CHARS);

      expect(text.length).toBeLessThanOrEqual(CAPTION_LIMIT_CHARS);
      expect(text).toContain('…</i>');
      expect(text).toContain('🔗 Подробнее');
      expect(text).toContain('🏠 <b>t1</b>');
    });

    it('drops the description rather than shipping a bare ellipsis', () => {
      const text = card({ title: long(1000), description: long(2000) }, CAPTION_LIMIT_CHARS);

      expect(text.length).toBeLessThanOrEqual(CAPTION_LIMIT_CHARS);
      expect(text).not.toContain('<i>');
    });

    it('trims the title last, and never the price or the link', () => {
      const text = card(
        { title: long(4000), priceUsd: 33000, description: undefined },
        CAPTION_LIMIT_CHARS,
      );

      expect(text.length).toBeLessThanOrEqual(CAPTION_LIMIT_CHARS);
      expect(text).toContain('💰 $33\u00A0000');
      expect(text).toContain('<a href="https://re.kufar.by/vi/1">🔗 Подробнее</a>');
    });

    // The core the card never trims — address, details, seller — can itself exceed the budget.
    // A photo-less card has no text fallback to catch the resulting 400, so it would be rebuilt
    // and rejected on every run: the price and the link have to survive, the rest gives way.
    it('drops the details before it ships a card over the limit', () => {
      const text = card(
        {
          priceUsd: 33000,
          address: long(300),
          seller: long(300),
          details: Array.from({ length: 20 }, (_, i) => ({ label: `л${i}`, value: long(50) })),
        },
        400,
      );

      expect(text.length).toBeLessThanOrEqual(400);
      expect(text).toContain('💰 $33\u00A0000');
      expect(text).toContain('<a href="https://re.kufar.by/vi/1">🔗 Подробнее</a>');
    });

    // Escaping inflates: 500 ampersands become 2500 characters, so the trim has to be measured
    // on the escaped output or the message goes over the limit and Telegram rejects it.
    it('counts the escaped text, not the raw text', () => {
      const text = card({ title: '&'.repeat(500), description: '<'.repeat(500) }, 300);

      expect(text.length).toBeLessThanOrEqual(300);
    });
  });
});

describe('formatPrice', () => {
  // ru-RU groups thousands with U+00A0, so the expectations spell it out rather than look
  // identical to a plain space and fail unreadably.
  const NBSP = '\u00A0';

  it('shows both currencies — neither alone answers "is it cheap"', () => {
    expect(formatPrice(makeListing(1, { priceByn: 96921, priceUsd: 33000 }))).toBe(
      `96${NBSP}921 BYN / $33${NBSP}000`,
    );
  });

  it.each([
    ['only BYN', { priceByn: 19401 }, `19${NBSP}401 BYN`],
    ['only USD', { priceUsd: 7000 }, `$7${NBSP}000`],
  ])('shows %s when that is all the source gave', (_label, prices, expected) => {
    expect(formatPrice(makeListing(1, prices))).toBe(expected);
  });

  it('says «Договорная» when there is no price — a blank line reads as our bug', () => {
    expect(formatPrice(makeListing(1))).toBe('Договорная');
  });
});

describe('formatListTime', () => {
  const now = new Date('2026-09-11T12:00:00+03:00');

  it.each([
    ['the same day', '2026-09-11T09:30:00+03:00', 'сегодня 09:30'],
    // 17 h 45 m old, so an elapsed-hours rule would call this «сегодня 18:15» — a falsehood.
    ['the previous evening', '2026-09-10T18:15:00+03:00', 'вчера 18:15'],
    ['just after midnight', '2026-09-11T00:10:00+03:00', 'сегодня 00:10'],
  ])('phrases %s the way a reader thinks about it', (_label, iso, expected) => {
    expect(formatListTime(iso, now)).toBe(expected);
  });

  it('falls back to the date for anything older', () => {
    expect(formatListTime('2026-06-13T20:02:02+03:00', now)).toBe('13.06.2026');
  });

  it('uses Minsk time, not the host clock — a pod runs on UTC', () => {
    expect(formatListTime('2026-09-11T06:00:00Z', now)).toBe('сегодня 09:00');
  });

  it('yields nothing for an unparseable stamp instead of "Invalid Date"', () => {
    expect(formatListTime('not a date', now)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('covers the four characters that break an HTML-parsed message', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('listingCard — pathological input', () => {
  it('never exceeds the limit, even when the link alone is longer than the card', () => {
    // `link` is source-controlled (kufar's `ad_link`). An oversized card is a Telegram 400, and
    // nothing undelivered is marked seen — so it would be retried, and refused, on every run.
    const card = listingCard(
      makeListing(1, { link: `https://re.kufar.by/vi/${'9'.repeat(2000)}`, priceUsd: 7000 }),
      CAPTION_LIMIT_CHARS,
    );

    expect(card.length).toBeLessThanOrEqual(CAPTION_LIMIT_CHARS);
    expect(card).toContain('7');
  });

  it('does not mark a title as cut when it was not cut', () => {
    // The last-resort branch used to run every title through the clamp, which appends «…»
    // unconditionally — claiming a cut that never happened and adding the one char that can put
    // the card over the limit.
    const listing = makeListing(1, {
      title: 'Дом в Гродно',
      address: 'а'.repeat(1500),
      priceUsd: 7000,
    });

    const card = listingCard(listing, CAPTION_LIMIT_CHARS);

    expect(card).toContain('Дом в Гродно');
    expect(card).not.toContain('Дом в Гродно…');
    expect(card.length).toBeLessThanOrEqual(CAPTION_LIMIT_CHARS);
  });
});

describe('the search a card came from', () => {
  it('names the search beside the counter', () => {
    const text = listingCard(makeListing(1), MESSAGE_LIMIT_CHARS, {
      index: 2,
      total: 5,
      search: 'kufar · grodno/kupit/dom',
    });

    expect(text.split('\n')[0]).toBe('🆕 2/5 — kufar · grodno/kupit/dom');
  });

  // The URL is pasted by the user, and a path can decode to markup. Unescaped, Telegram rejects
  // the card with a 400 — and since nothing is marked seen until delivered, the same broken card
  // is rebuilt on every run and the subscription never recovers.
  it('escapes the label, which is built from a URL the user chose', () => {
    const text = listingCard(makeListing(1), MESSAGE_LIMIT_CHARS, {
      index: 1,
      total: 1,
      search: 'kufar · <b>hi</b>/kupit',
    });

    expect(text.split('\n')[0]).toBe('kufar · &lt;b&gt;hi&lt;/b&gt;/kupit');
  });

  // The counter is noise for a single card, but the search is not — it is the whole point.
  it('keeps the search when a lone card has no counter', () => {
    const text = listingCard(makeListing(1), MESSAGE_LIMIT_CHARS, {
      index: 1,
      total: 1,
      search: 'realt · sale/plots',
    });

    expect(text.split('\n')[0]).toBe('realt · sale/plots');
  });
});
