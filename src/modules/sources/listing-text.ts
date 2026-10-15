import { LOCALE } from '@/common/locale';

/**
 * How listing facts read on a card, for every source alike. Adapters map their site's codes onto
 * these inputs (hh's `BYR` → `BYN`, `HOUR` → `hour`) — the wording lives here, once.
 */

const grouped = (value: number): string => value.toLocaleString(LOCALE);

/** «1 500 – 2 000 руб.», «от 3 150 руб./м²», «до 900 $» — or undefined with neither bound. */
export function rangeText({
  from,
  to,
  unit,
}: {
  from?: number;
  to?: number;
  unit: string;
}): string | undefined {
  if (from !== undefined && to !== undefined) {
    return from === to ? `${grouped(from)} ${unit}` : `${grouped(from)} – ${grouped(to)} ${unit}`;
  }
  if (from !== undefined) return `от ${grouped(from)} ${unit}`;
  if (to !== undefined) return `до ${grouped(to)} ${unit}`;
  return undefined;
}

/** Shown when a vacancy states no salary — a blank price line reads as our bug. */
export const NO_SALARY = 'зарплата не указана';

// ISO 4217 alpha codes as a reader expects to see them; an unknown code prints as itself.
const CURRENCY_SIGN: Record<string, string> = { BYN: 'руб.', RUB: '₽', USD: '$', EUR: '€' };

export type PayPeriod = 'month' | 'hour' | 'shift';
const PER: Record<PayPeriod, string> = { month: '', hour: ' в час', shift: ' за смену' };

/**
 * A site's pay-period word («HOUR», «hourly», «в час», «SHIFT»…) as a PayPeriod; anything else —
 * including nothing — is a month, the default every job site measured uses.
 */
export function asPayPeriod(value: unknown): PayPeriod {
  const word = typeof value === 'string' ? value.toLowerCase() : '';
  if (/hour|час/.test(word)) return 'hour';
  if (/shift|смен/.test(word)) return 'shift';
  return 'month';
}

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
  const amount = rangeText({
    from,
    to,
    unit: `${CURRENCY_SIGN[currency] ?? currency}${PER[period]}`,
  });
  if (amount === undefined) return undefined;
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

/**
 * A preview the SITE already cut at `cutAt` characters, marked as cut — otherwise it just stops
 * mid-word. Text of that length or more is taken to be cut.
 */
export function markCut(text: string | undefined, cutAt: number): string | undefined {
  return text !== undefined && text.length >= cutAt ? `${text}…` : text;
}

/** «5.0 (8 отз.)» — or undefined without reviews: a score nobody gave is noise, not a rating. */
export function ratingText(
  score: string | undefined,
  reviews: number | undefined,
): string | undefined {
  return score === undefined || reviews === undefined ? undefined : `${score} (${reviews} отз.)`;
}
