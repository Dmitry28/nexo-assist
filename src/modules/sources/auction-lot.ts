import type { Listing } from './source-adapter';

/**
 * The lot facts the US auction parsers (Copart, IAAI) put on a card — and the bid.cars fallback
 * filters by, since the auctions' own searches do not take those filters. One spelling for both.
 */
export const LOT_LABELS = { odometer: 'Пробег', engine: 'Двигатель', start: 'Запуск' } as const;

export type StartCode = 'run-and-drive' | 'starts' | 'stationary';

const START_TEXT: Record<StartCode, string> = {
  'run-and-drive': 'Run and Drive',
  starts: 'Starts',
  stationary: 'Stationary',
};

/** The auctions' wording — IAAI's «Run & Drive» badge, Copart's «RUN AND DRIVE» — as one code. */
export function startCode(text: string | undefined): StartCode | undefined {
  // `&amp;` too, nested: the IAAI page through the proxy carries «Run &amp;amp; Drive» (2026-10-20).
  const words = text?.toLowerCase().replace(/&(amp;)*/g, ' and ');
  if (words === undefined) return undefined;
  if (/run[\s-]+and[\s-]+drive/.test(words)) return 'run-and-drive';
  // «DOES NOT START» / «NON-STARTER» is no start code we know, not «starts».
  if (/\b(not|non)\b[\s-]*start/.test(words)) return undefined;
  if (words.includes('start')) return 'starts';
  if (words.includes('stationary')) return 'stationary';
  return undefined;
}

/** The card's text for a start code — one spelling whatever the auction wrote. */
export const startText = (text: string | undefined): string | undefined => {
  const code = startCode(text);
  return code === undefined ? undefined : START_TEXT[code];
};

export interface Range {
  from?: number;
  to?: number;
}

/** What a lot must have — a filter the auctions' search did not apply. Miles and litres. */
export interface LotFilter {
  odometer?: Range;
  engine?: Range;
  start?: StartCode;
}

const fact = (listing: Listing, label: string): string | undefined =>
  listing.details.find((line) => line.label === label)?.value;

/** `89,003 mi` → 89003. */
const miles = (text: string | undefined): number | undefined => {
  const digits = text?.replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
};

/** `2.0L I-4 DI, DOHC` / `2.0L  4` → 2. */
const litres = (text: string | undefined): number | undefined => {
  const value = /(\d+(?:\.\d+)?)\s*L\b/i.exec(text ?? '')?.[1];
  return value === undefined ? undefined : Number(value);
};

const inRange = (value: number | undefined, range: Range | undefined): boolean =>
  range === undefined ||
  (value !== undefined &&
    (range.from === undefined || value >= range.from) &&
    (range.to === undefined || value <= range.to));

/**
 * Whether a lot passes the filter. A lot that does not say (no odometer, no engine, no start
 * code) fails it — the site with the filter would not have listed it either.
 */
export const matchesLot = (listing: Listing, filter: LotFilter): boolean =>
  inRange(miles(fact(listing, LOT_LABELS.odometer)), filter.odometer) &&
  inRange(litres(fact(listing, LOT_LABELS.engine)), filter.engine) &&
  (filter.start === undefined || startCode(fact(listing, LOT_LABELS.start)) === filter.start);

/**
 * A fact the filter needs that not one of a house's lots carries — the parser no longer finds the
 * field (renamed, moved), not lots that all lack it. Undefined when every needed fact is seen.
 */
export function missingFact(listings: Listing[], filter: LotFilter): string | undefined {
  // Not the start code: it is an optional badge (IAAI shows «Run & Drive» / «Starts», measured
  // 2026-10-20; a stationary lot may carry none), so a run of lots without it proves nothing.
  const needed = [
    filter.odometer && LOT_LABELS.odometer,
    filter.engine && LOT_LABELS.engine,
  ].filter((label) => label !== undefined);
  return needed.find((label) => !listings.some((listing) => fact(listing, label) !== undefined));
}
