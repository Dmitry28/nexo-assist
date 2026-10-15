const UNIT_MS: Array<[RegExp, number]> = [
  [/^секунд/, 1000],
  [/^минут/, 60_000],
  [/^час/, 3_600_000],
  [/^(дн|ден)/, 86_400_000],
  [/^недел/, 7 * 86_400_000],
  [/^месяц/, 30 * 86_400_000],
  [/^(год|лет)/, 365 * 86_400_000],
];

/**
 * The first «N <unit> назад» in `text` («5 дней назад», «час назад» — a missing N is 1), as that
 * moment before `now` — or undefined when there is none. Approximate by nature: sites that print only this
 * give no date, so a month is 30 days and a year 365.
 */
export function timeAgo(text: string, now: Date): Date | undefined {
  const match = /(?:(\d+)\s+)?([а-яё]+)\s+назад/i.exec(text);
  const unit = match && UNIT_MS.find(([re]) => re.test(match[2].toLowerCase()))?.[1];
  return unit ? new Date(now.getTime() - Number(match[1] ?? 1) * unit) : undefined;
}
