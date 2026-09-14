import { LOCALE, TIMEZONE } from '@/common/locale';
import type { Listing, ListingDetail } from '@/modules/sources/source-adapter';

import { truncate } from './telegram.format';

/** Telegram's ceiling for a photo caption — a fifth of what a plain message allows. */
export const CAPTION_LIMIT_CHARS = 1024;
/** Telegram's ceiling for a text message. */
export const MESSAGE_LIMIT_CHARS = 4096;

/** Shown instead of a price the seller did not set — a blank line reads as our bug. */
const NEGOTIABLE = 'Договорная';

/**
 * Escape text that goes into an HTML-parsed message. Everything interpolated below is scraped
 * from a third-party site, and a single stray `<` or `&` makes Telegram reject the whole
 * message with a 400 — which, since nothing is marked seen until it is delivered, would rebuild
 * the same broken card on every run and block that subscription for good.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // The quote matters for the link below: a listing URL comes from the source (kufar hands us
    // `ad_link`), and one quote inside an href ends the attribute early.
    .replace(/"/g, '&quot;');

/** Both currencies, because the sites quote in both and neither alone answers "is it cheap". */
export function formatPrice(listing: Listing): string {
  const parts: string[] = [];
  if (listing.priceByn !== undefined) parts.push(`${listing.priceByn.toLocaleString(LOCALE)} BYN`);
  if (listing.priceUsd !== undefined) parts.push(`$${listing.priceUsd.toLocaleString(LOCALE)}`);
  return parts.length > 0 ? parts.join(' / ') : NEGOTIABLE;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (date: Date): string =>
  date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
// The Minsk calendar day as a comparable key. Formatting both sides in one timezone is what
// makes the comparison right regardless of where the pod runs.
const day = (date: Date): string => date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

/**
 * When the listing was last bumped, phrased the way the reader thinks about it: a search checked
 * once a day is answered by «сегодня» far better than by an ISO stamp.
 *
 * Calendar days, not elapsed hours. The prototype compared against 24 h, which at noon prints
 * «сегодня 18:15» for an ad from the previous evening — a freshness cue that states a falsehood.
 */
export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (day(date) === day(now)) return `сегодня ${time(date)}`;
  if (day(date) === day(new Date(now.getTime() - DAY_MS))) return `вчера ${time(date)}`;
  return date.toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
}

/** Which card of how many — a run of 30 cards is otherwise a wall with no end in sight. */
export interface CardPosition {
  index: number;
  total: number;
}

/**
 * A card's text, escaped once. Every scraped field is escaped on the way in here, so `compose`
 * below is pure layout: a block added later cannot forget the escaping and turn one bad
 * character into a subscription that fails on every run.
 */
interface CardText {
  title: string;
  description?: string;
  address?: string;
  seller?: string;
  details: ListingDetail[];
  /** Built from numbers, so nothing to escape. */
  price: string;
  listTime: string;
  link: string;
}

const escapeCard = (listing: Listing): CardText => ({
  title: escapeHtml(listing.title),
  description: listing.description === undefined ? undefined : escapeHtml(listing.description),
  address: listing.address === undefined ? undefined : escapeHtml(listing.address),
  seller: listing.seller === undefined ? undefined : escapeHtml(listing.seller),
  details: listing.details.map(({ label, value }) => ({
    label: escapeHtml(label),
    value: escapeHtml(value),
  })),
  price: formatPrice(listing),
  listTime: formatListTime(listing.listTime),
  link: escapeHtml(listing.link),
});

/** The card's blocks, in reading order. */
function compose(card: CardText, position?: CardPosition): string {
  const lines: string[] = [];
  // A single card needs no counter: "1/1" is noise.
  if (position !== undefined && position.total > 1) {
    lines.push(`🆕 ${position.index}/${position.total}`);
  }
  lines.push(`🏠 <b>${card.title}</b>`);
  if (card.description !== undefined) lines.push(`<i>${card.description}</i>`);
  lines.push('');
  if (card.address !== undefined) lines.push(`📍 ${card.address}`);
  lines.push(`💰 ${card.price}`);
  for (const { label, value } of card.details) lines.push(`${label}: ${value}`);
  if (card.seller !== undefined) lines.push(`👤 ${card.seller}`);
  if (card.listTime !== '') lines.push(`🕐 ${card.listTime}`);
  lines.push('', `<a href="${card.link}">🔗 Подробнее</a>`);
  return lines.join('\n');
}

/**
 * A cut that landed inside an HTML entity — «&amp» without its «;» renders literally at best and
 * rejects the message at worst. Half-written only: a complete entity ends in «;» and survives.
 */
const PARTIAL_ENTITY = /&[a-z]*$/i;

/**
 * Cut already-escaped text to at most `max` characters, ellipsis included.
 *
 * Escaped, not raw, on purpose: the budget is measured on the composed message, and escaping can
 * quintuple a length («&» → «&amp;»), so trimming the raw text overshoots the limit — which is a
 * Telegram 400 and, since nothing undelivered is marked seen, a card that fails forever.
 */
const clamp = (escaped: string, max: number): string => truncate(escaped, max, PARTIAL_ENTITY);

/**
 * One listing as one message, at most `limit` characters — pass `CAPTION_LIMIT_CHARS` when a
 * photo carries it, `MESSAGE_LIMIT_CHARS` when it stands alone.
 *
 * What gets cut, in order: the description, then the title, and only then the blocks that
 * identify the object (address, details, seller). The price and the link are never trimmed — a
 * delivered listing is marked seen, so a card that arrives without its link is lost for good.
 */
export function listingCard(listing: Listing, limit: number, position?: CardPosition): string {
  const card = escapeCard(listing);

  const full = compose(card, position);
  if (full.length <= limit) return full;

  if (card.description !== undefined) {
    const room = card.description.length - (full.length - limit);
    // Nothing worth reading would be left — drop the block rather than ship a bare ellipsis.
    const description = room > 1 ? clamp(card.description, room) : undefined;
    const shorter = compose({ ...card, description }, position);
    if (shorter.length <= limit) return shorter;
  }

  const bare = { ...card, description: undefined };
  const trimmedTitle = clamp(
    card.title,
    card.title.length - (compose(bare, position).length - limit),
  );
  const withTrimmedTitle = compose({ ...bare, title: trimmedTitle }, position);
  if (withTrimmedTitle.length <= limit) return withTrimmedTitle;

  // Last resort: the blocks that identify the object are themselves over the limit. A card that
  // stays oversized is rejected by Telegram, and a listing without photos has no text fallback
  // to save it — so it would fail again on every later run. Price and link survive.
  const core = { ...bare, address: undefined, seller: undefined, details: [] };
  const room = card.title.length - (compose(core, position).length - limit);
  return compose({ ...core, title: clamp(card.title, room) }, position);
}
