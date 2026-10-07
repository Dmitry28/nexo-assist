const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * The first date in a Russian text as «дд.мм.гггг» — numeric («30.06.2025») or with the month
 * spelled out in any case («5 ноября 2026 г.», «27 ИЮНЯ 2025»). A display string, not a Date:
 * a calendar day carries no time zone, and building one would shift it.
 */
export function ruDate(text: string): string | undefined {
  const numeric = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(text);
  const spelled = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`).exec(
    text.toLowerCase(),
  );
  // The earlier of the two wins — a title's auction date precedes a decision date it cites.
  const candidates = [
    numeric && { at: numeric.index, day: +numeric[1], month: +numeric[2], year: numeric[3] },
    spelled && {
      at: spelled.index,
      day: +spelled[1],
      month: MONTHS.indexOf(spelled[2]) + 1,
      year: spelled[3],
    },
  ]
    .filter((c) => !!c)
    .filter((c) => c.day >= 1 && c.day <= 31 && c.month >= 1 && c.month <= 12)
    .sort((a, b) => a.at - b.at);
  const first = candidates[0];
  return first && `${pad2(first.day)}.${pad2(first.month)}.${first.year}`;
}
