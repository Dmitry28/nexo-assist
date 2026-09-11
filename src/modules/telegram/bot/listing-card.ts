import { LOCALE, TIMEZONE } from '@/common/locale';
import type { Listing } from '@/modules/sources/source-adapter';

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

/** The card's blocks, in reading order, with the parts that may be trimmed kept separate. */
function compose(listing: Listing, title: string, description: string | undefined): string {
  const lines = [`🏠 <b>${title}</b>`];
  if (description !== undefined) lines.push(`<i>${description}</i>`);
  lines.push('');
  if (listing.address !== undefined) lines.push(`📍 ${escapeHtml(listing.address)}`);
  lines.push(`💰 ${formatPrice(listing)}`);
  for (const { label, value } of listing.details) {
    lines.push(`${escapeHtml(label)}: ${escapeHtml(value)}`);
  }
  if (listing.seller !== undefined) lines.push(`👤 ${escapeHtml(listing.seller)}`);
  const listTime = formatListTime(listing.listTime);
  if (listTime !== '') lines.push(`🕐 ${listTime}`);
  lines.push('', `<a href="${escapeHtml(listing.link)}">🔗 Подробнее</a>`);
  return lines.join('\n');
}

/**
 * Cut already-escaped text to at most `max` characters, ellipsis included.
 *
 * Escaped, not raw, on purpose: the budget is measured on the composed message, and escaping can
 * quintuple a length («&» → «&amp;»), so trimming the raw text overshoots the limit — which is a
 * Telegram 400 and, since nothing is marked seen undelivered, a card that fails forever.
 * A cut therefore has to dodge two hazards it can land inside: an HTML entity and an emoji.
 */
function clamp(escaped: string, max: number): string {
  if (max <= 0) return '';
  const cut = escaped
    .slice(0, max - 1)
    .replace(/&[a-z]*;?$/i, '')
    .replace(/[\uD800-\uDBFF]$/, '');
  return `${cut}…`;
}

/**
 * One listing as one message, at most `limit` characters — pass `CAPTION_LIMIT_CHARS` when a
 * photo carries it, `MESSAGE_LIMIT_CHARS` when it stands alone.
 *
 * What gets cut, in order: the description, then the title. The price, the details and the link
 * are never trimmed — a delivered listing is marked seen, so a card that arrives without its
 * link is lost for good, and that is the one thing the reader needs from us.
 */
export function listingCard(listing: Listing, limit: number): string {
  const title = escapeHtml(listing.title);
  const description =
    listing.description === undefined ? undefined : escapeHtml(listing.description);

  const full = compose(listing, title, description);
  if (full.length <= limit) return full;

  if (description !== undefined) {
    const room = description.length - (full.length - limit);
    // Nothing worth reading would be left — drop the block rather than ship a bare ellipsis.
    const shorter = compose(listing, title, room > 1 ? clamp(description, room) : undefined);
    if (shorter.length <= limit) return shorter;
  }

  const bare = compose(listing, title, undefined);
  return compose(listing, clamp(title, title.length - (bare.length - limit)), undefined);
}
