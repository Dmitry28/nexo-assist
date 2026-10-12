import type { Listing } from '@/modules/sources/source-adapter';

/**
 * What a subscription remembers of a listing it delivered — enough to tell a price change or a
 * removal and to show it. A narrow pick, not the whole Listing: the stored jsonb outlives today's
 * Listing shape.
 */
export interface ListingSnapshot {
  link: string;
  title: string;
  priceByn?: number;
  priceUsd?: number;
  /** Shown as the last price of a removed listing; never compared (see hasPriceChanged). */
  priceText?: string;
}

/** A listing whose seller changed the price since it was last recorded. */
export interface PriceChange {
  before: ListingSnapshot;
  after: Listing;
}

export const toSnapshot = ({
  link,
  title,
  priceByn,
  priceUsd,
  priceText,
}: Listing): ListingSnapshot => ({ link, title, priceByn, priceUsd, priceText });

const optionalNumber = (value: unknown): boolean =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value));

/** A stored snapshot, or undefined for a row that has none or one this code cannot read. */
export function asSnapshot(value: unknown): ListingSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { link, title, priceByn, priceUsd, priceText } = value as Record<string, unknown>;
  if (typeof link !== 'string' || typeof title !== 'string') return undefined;
  if (!optionalNumber(priceByn) || !optionalNumber(priceUsd)) return undefined;
  if (priceText !== undefined && typeof priceText !== 'string') return undefined;
  return {
    link,
    title,
    priceByn: priceByn as number | undefined,
    priceUsd: priceUsd as number | undefined,
    priceText,
  };
}

/**
 * Minimum relative move, in percent — in BOTH currencies when the listing carries two.
 *
 * Measured in the prototype: between two daily runs the BYN/USD rate moves well under 1 %, so a
 * real edit of ≥ 2 % is never masked and drift never reaches it. Tweaks below 2 % go unreported.
 */
export const MIN_PRICE_CHANGE_PERCENT = 2;

// 0 and a missing price both mean "no price".
const positive = (price: number | undefined): number | undefined =>
  price !== undefined && price > 0 ? price : undefined;

type Prices = Pick<Listing, 'priceByn' | 'priceUsd'>;

const hasPrice = (prices: Prices): boolean =>
  positive(prices.priceByn) !== undefined || positive(prices.priceUsd) !== undefined;

/** Signed relative move, in percent. */
const movePercent = (before: number, after: number): number => ((after - before) / before) * 100;

/**
 * True when the seller changed the price, as opposed to the exchange rate moving (rule ported
 * from the prototype, measured on live data — PRODUCT_PLAN.md § 2.4).
 *
 * Both figures are conversions of one base price, so a seller edit scales them alike: same
 * direction, both past the floor. Drift moves them by different amounts, often oppositely (two
 * unrelated realt listings shared an identical -2.58 % / +0.69 % — only a rate change does that).
 * A single figure is not drift-free either (prometr's BYN wobbled 0.08 % a day), so the floor stays.
 *
 * Only numbers are compared: a text price (a salary, a per-m² range) has no percentage, and
 * «з/п не указана» → a salary is no price change. A price appearing («договорная» → priced) counts;
 * one disappearing does not — that is a page that failed to show it far more often than a seller
 * removing it, and it would come back as a second, false «changed» when the price reappears.
 */
export function hasPriceChanged(before: Prices, after: Prices): boolean {
  if (!hasPrice(after)) return false;
  const [byn0, usd0] = [positive(before.priceByn), positive(before.priceUsd)];
  const [byn1, usd1] = [positive(after.priceByn), positive(after.priceUsd)];
  const byn = byn0 !== undefined && byn1 !== undefined ? movePercent(byn0, byn1) : undefined;
  const usd = usd0 !== undefined && usd1 !== undefined ? movePercent(usd0, usd1) : undefined;
  const past = (move: number): boolean => Math.abs(move) >= MIN_PRICE_CHANGE_PERCENT;
  if (byn !== undefined && usd !== undefined) {
    return byn > 0 === usd > 0 && past(byn) && past(usd);
  }
  if (byn !== undefined) return past(byn);
  if (usd !== undefined) return past(usd);
  return !hasPrice(before);
}

/**
 * Whether a re-seen listing's stored snapshot gets replaced by what the site shows now (a seller's
 * edit, a parser fix must reach storage). Not when the price vanished: the old one is kept, so its
 * return is no «change».
 */
export const replacesSnapshot = (before: Prices, after: Prices): boolean =>
  hasPrice(after) || !hasPrice(before);
