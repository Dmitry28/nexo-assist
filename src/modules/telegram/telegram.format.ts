import type { Listing } from '@/modules/sources/source-adapter';

/** Reusable "no link preview" message option. */
export const NO_LINK_PREVIEW = { is_disabled: true } as const;

// Shared char budget with headroom under Telegram's 4096-char message limit (an
// oversized send throws — and would then be rebuilt oversized and fail on every retry).
export const MAX_MESSAGE_BUDGET_CHARS = 3500;
// Digest item-count cap for readability.
// DIGEST_LIMIT is exported for specs; production callers get the delivered slice.
export const DIGEST_LIMIT = 10;
// Clamp pathological titles — one huge line must not eat the char budget (it would
// produce an item-less digest that delivers nothing and repeats forever).
const MAX_TITLE_CHARS = 300;

function price(listing: Listing): string {
  if (listing.priceUsd !== undefined) return `$${listing.priceUsd}`;
  if (listing.priceByn !== undefined) return `${listing.priceByn} BYN`;
  return 'price n/a';
}

function formatOne(listing: Listing): string {
  const title =
    listing.title.length > MAX_TITLE_CHARS
      ? `${listing.title.slice(0, MAX_TITLE_CHARS)}…`
      : listing.title;
  return `${title}\n${price(listing)}\n${listing.link}`;
}

/** A listings digest under `header`: items up to the caps, then an "…and N more" footer. */
function digest(listings: Listing[], header: string): { text: string; shown: Listing[] } {
  const lines: string[] = [];
  const shown: Listing[] = [];
  let length = header.length;
  for (const listing of listings) {
    const line = formatOne(listing);
    if (shown.length >= DIGEST_LIMIT || length + line.length > MAX_MESSAGE_BUDGET_CHARS) break;
    lines.push(line);
    shown.push(listing);
    length += line.length + '\n\n'.length;
  }
  const more = listings.length - shown.length;
  const footer = more > 0 ? `\n\n…and ${more} more` : '';
  return { text: `${header}\n\n${lines.join('\n\n')}${footer}`, shown };
}

export const formatCurrentListings = (listings: Listing[]): string =>
  digest(listings, `📋 ${listings.length} current`).text;

/**
 * The "new listings" digest plus the exact slice it shows. Callers must markSeen
 * only `delivered` — the overflow beyond the caps surfaces on a later run.
 * NOTE: newest-first means sustained volume > cap starves the oldest items; fixed
 * by batched delivery (Phase 7).
 */
export function newListingsDigest(fresh: Listing[]): { text: string; delivered: Listing[] } {
  const { text, shown } = digest(fresh, `🆕 ${fresh.length} new`);
  return { text, delivered: shown };
}

/** Sent when a subscription is auto-paused because its URL kept failing. */
export const deadSubscriptionNotice = ({ source, url }: { source: string; url: string }): string =>
  `⚠️ This ${source} search stopped responding, so I've paused it. ` +
  `Check the link and send it again if it still works.\n${url}`;

/** Admin `/stats` snapshot. */
export const formatStats = (s: {
  users: number;
  active: number;
  paused: number;
  lastRunAt?: Date;
}): string =>
  [
    '📊 Stats',
    `👥 users: ${s.users}`,
    `📋 active subscriptions: ${s.active}`,
    `⏸ paused: ${s.paused}`,
    `🕒 last run: ${s.lastRunAt ? s.lastRunAt.toISOString() : 'never'}`,
  ].join('\n');
