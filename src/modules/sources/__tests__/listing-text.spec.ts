import { asPayPeriod, markCut, preview, rangeText, ratingText, salaryText } from '../listing-text';

describe('salaryText', () => {
  it.each([
    [{ from: 1500, to: 2000, currency: 'BYN' }, '1\u00a0500 – 2\u00a0000 руб.'],
    [{ from: 1500, currency: 'BYN' }, 'от 1\u00a0500 руб.'],
    [{ to: 900, currency: 'USD' }, 'до 900 $'],
    [{ from: 15, to: 15, currency: 'BYN', period: 'hour' as const }, '15 руб. в час'],
    [
      { from: 2000, to: 3000, currency: 'RUB', gross: true },
      '2\u00a0000 – 3\u00a0000 ₽, до вычета налогов',
    ],
    [{ from: 10, currency: 'KZT' }, 'от 10 KZT'],
    [{ currency: 'BYN' }, undefined],
  ])('%p → %p', (input, expected) => {
    expect(salaryText(input)).toBe(expected);
  });
});

describe('preview', () => {
  it('cuts a long text to 150 characters and marks the cut, leaves a short one alone', () => {
    expect(preview('a'.repeat(200))).toBe(`${'a'.repeat(150)}…`);
    expect(preview('short')).toBe('short');
    expect(preview(undefined)).toBeUndefined();
  });
});

describe('ratingText', () => {
  it('shows a score with its review count, nothing without reviews', () => {
    expect(ratingText('5.0', 8)).toBe('5.0 (8 отз.)');
    expect(ratingText('0.0', undefined)).toBeUndefined();
  });
});

describe('asPayPeriod', () => {
  it.each([
    ['HOUR', 'hour'],
    ['в час', 'hour'],
    ['SHIFT', 'shift'],
    ['MONTH', 'month'],
    [undefined, 'month'],
  ])('%p → %s', (value, expected) => {
    expect(asPayPeriod(value)).toBe(expected);
  });
});

describe('markCut', () => {
  it('marks text the site cut at its length, leaves shorter text alone', () => {
    expect(markCut('a'.repeat(150), 150)).toBe(`${'a'.repeat(150)}…`);
    expect(markCut('short', 150)).toBe('short');
  });
});

describe('rangeText', () => {
  it('groups thousands, and reads one bound as «от»/«до»', () => {
    expect(rangeText({ from: 3150, to: 3500, unit: 'руб./м²' })).toBe(
      '3\u00a0150 – 3\u00a0500 руб./м²',
    );
    expect(rangeText({ to: 900, unit: '$' })).toBe('до 900 $');
    expect(rangeText({ unit: '$' })).toBeUndefined();
  });
});
