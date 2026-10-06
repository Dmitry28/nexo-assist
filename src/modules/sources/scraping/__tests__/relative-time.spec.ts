import { timeAgo } from '../relative-time';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('timeAgo', () => {
  it.each([
    ['Обновлено 8 секунд назад', '2026-10-06T11:59:52.000Z'],
    ['Обновлено 5 часов назад', '2026-10-06T07:00:00.000Z'],
    ['1 дней назад', '2026-10-05T12:00:00.000Z'],
    ['2 недели назад', '2026-09-22T12:00:00.000Z'],
    ['1 месяц назад', '2026-09-06T12:00:00.000Z'],
    ['1 год назад', '2025-10-06T12:00:00.000Z'],
    ['Обновлено час назад', '2026-10-06T11:00:00.000Z'],
  ])('%s → %s', (text, expected) => {
    expect(timeAgo(text, NOW)?.toISOString()).toBe(expected);
  });

  it('answers undefined for text with no «N … назад»', () => {
    expect(timeAgo('Обновлено недавно', NOW)).toBeUndefined();
  });
});
