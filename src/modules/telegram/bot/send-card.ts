import type { Logger } from '@nestjs/common';
import { GrammyError } from 'grammy';
import type { Api } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';

import { wait } from '@/common/wait';
import type { Coordinates, Listing } from '@/modules/sources/source-adapter';

import type { CardPosition } from './listing-card';
import { CAPTION_LIMIT_CHARS, MESSAGE_LIMIT_CHARS, listingCard } from './listing-card';
import { NO_LINK_PREVIEW } from './telegram.format';

/** Telegram's hard cap on one media group — an eleventh photo is a rejected request. */
export const MAX_PHOTOS_PER_CARD = 10;

// Pause between messages to one chat. Telegram tolerates about one per second per chat; the
// auto-retry plugin would survive a 429 anyway, but waiting is cheaper than being rate-limited.
// It lives with the send path, not with the delivery loop, because a card is more than one
// message: a refused photo and a map pin are extra requests to the same chat.
export const SEND_DELAY_MS = 1000;

/**
 * A Telegram 403 means delivery to this chat is impossible — the user blocked the bot or deleted
 * the account. It lives here because it is the one send failure no fallback can help: callers
 * treat it as a state to handle (pause the user), not as a defect.
 */
export function isBotBlocked(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/** One listing, ready to send: the card text plus whatever media the source published. */
export interface ListingMessage {
  caption: string;
  images: string[];
  coordinates?: Coordinates;
}

/**
 * Where a card goes. Two implementations exist on purpose: the scheduled run sends through the
 * bot API to a stored chat id, while /check replies inside the update it is handling — and
 * wiring the service into the handlers would close the DI cycle documented in
 * `src/__tests__/di-wiring.spec.ts`.
 */
export interface CardSender {
  photo(url: string, caption: string): Promise<unknown>;
  group(media: InputMediaPhoto[]): Promise<unknown>;
  /** The card as a message of its own — HTML, like every caption here. */
  html(text: string): Promise<unknown>;
  location(at: Coordinates): Promise<unknown>;
}

/**
 * A sender that talks to a chat through the bot API.
 *
 * Shared with `scripts/notify-test.ts` on purpose: that script exists to catch formatting
 * regressions in the real send path, and a private copy would drift until it exercised a path
 * production no longer uses — while still reporting success.
 */
export function apiCardSender(api: Api, chatId: number): CardSender {
  return {
    photo: (url, caption) => api.sendPhoto(chatId, url, { caption, parse_mode: 'HTML' }),
    group: (media) => api.sendMediaGroup(chatId, media),
    html: (text) =>
      api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: NO_LINK_PREVIEW }),
    location: ({ lat, lon }) => api.sendLocation(chatId, lat, lon),
  };
}

/**
 * The card for one listing. Photos get the caption limit (a fifth of a message's), and a
 * listing without photos gets the full one.
 */
export function listingMessage(listing: Listing, position?: CardPosition): ListingMessage {
  const limit = listing.images.length > 0 ? CAPTION_LIMIT_CHARS : MESSAGE_LIMIT_CHARS;
  return {
    caption: listingCard(listing, limit, position),
    images: listing.images,
    coordinates: listing.coordinates,
  };
}

/**
 * Send one listing: its photos carry the card, and the card falls back to a plain message if
 * Telegram refuses the media. Resolves once the listing has reached the user in some form —
 * callers mark seen on that, so anything that leaves it undelivered throws instead.
 *
 * NOTE: kufar's image CDN does answer 302 (`rms.kufar.by` → a `rms8…` shard) — verified live on
 * an ad, so the prototype's warning about `WEBPAGE_MEDIA_EMPTY` in a media group is about a real
 * redirect. What is still unobserved is Telegram failing on it. We therefore do not pre-resolve
 * (up to ten HEAD requests per card, against a shard host we would then be pinning): the fallback
 * below keeps the listing arriving, and `onPhotoFallback` counts how often that happens — a
 * metric, because a pod's log cannot answer "is this systematic?".
 */
export async function sendCard(
  sender: CardSender,
  { caption, images, coordinates }: ListingMessage,
  logger: Logger,
  onPhotoFallback?: () => void,
): Promise<void> {
  const photos = images.slice(0, MAX_PHOTOS_PER_CARD);
  try {
    await withPhotos(sender, caption, photos);
  } catch (err) {
    // A blocked chat rejects the text too, and the run pauses the user on this error — a second
    // doomed request would only add another failure to report.
    if (photos.length === 0 || isBotBlocked(err)) throw err;
    logger.warn({ err }, 'Photo send failed — falling back to the text card');
    onPhotoFallback?.();
    // Paced like every other message to this chat: the refused send still counted against the
    // per-chat limit, and this retry is what actually delivers the listing.
    await wait(SEND_DELAY_MS);
    await sender.html(caption);
  }
  // The listing is already delivered, so a missing pin is not worth failing the delivery for.
  if (coordinates) {
    await wait(SEND_DELAY_MS);
    await sender
      .location(coordinates)
      .catch((err: unknown) => logger.warn({ err }, 'Location pin failed'));
  }
}

function withPhotos(sender: CardSender, caption: string, photos: string[]): Promise<unknown> {
  if (photos.length === 0) return sender.html(caption);
  if (photos.length === 1) return sender.photo(photos[0], caption);
  // Telegram shows the caption of the FIRST item as the group's caption and ignores the rest.
  const media: InputMediaPhoto[] = photos.map((photo, i) =>
    i === 0
      ? { type: 'photo', media: photo, caption, parse_mode: 'HTML' }
      : { type: 'photo', media: photo },
  );
  return sender.group(media);
}
