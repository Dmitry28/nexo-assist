/**
 * How listing facts read on a card, for every source alike. Adapters map their site's codes onto
 * these inputs (hh's `BYR` → `BYN`, `HOUR` → `hour`) — the wording lives here, once.
 */

/** Shown when a vacancy states no salary — a blank price line reads as our bug. */
export const NO_SALARY = 'зарплата не указана';

// ISO 4217 alpha codes as a reader expects to see them; an unknown code prints as itself.
const CURRENCY_SIGN: Record<string, string> = { BYN: 'руб.', RUB: '₽', USD: '$', EUR: '€' };

export type PayPeriod = 'month' | 'hour' | 'shift';
const PER: Record<PayPeriod, string> = { month: '', hour: ' в час', shift: ' за смену' };

/**
 * «1500 – 2000 руб.», «от 15 руб. в час, до вычета налогов» — or undefined with neither bound.
 * `gross`: before tax, which job sites mark and a reader needs to compare offers.
 */
export function salaryText({
  from,
  to,
  currency,
  period = 'month',
  gross = false,
}: {
  from?: number;
  to?: number;
  currency: string;
  period?: PayPeriod;
  gross?: boolean;
}): string | undefined {
  const unit = `${CURRENCY_SIGN[currency] ?? currency}${PER[period]}`;
  let amount: string;
  if (from !== undefined && to !== undefined) {
    amount = from === to ? `${from} ${unit}` : `${from} – ${to} ${unit}`;
  } else if (from !== undefined) amount = `от ${from} ${unit}`;
  else if (to !== undefined) amount = `до ${to} ${unit}`;
  else return undefined;
  return gross ? `${amount}, до вычета налогов` : amount;
}

// The length kufar's sale ads arrive cut to (`body_short`), so cards read alike across sources.
const PREVIEW_CHARS = 150;

/** A full description cut to a card-sized preview, marked as cut. */
export function preview(text: string | undefined): string | undefined {
  return text !== undefined && text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…`
    : text;
}

/** «5.0 (8 отз.)» — or undefined without reviews: a score nobody gave is noise, not a rating. */
export function ratingText(
  score: string | undefined,
  reviews: number | undefined,
): string | undefined {
  return score === undefined || reviews === undefined ? undefined : `${score} (${reviews} отз.)`;
}
