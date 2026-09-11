import type { Logger } from '@nestjs/common';
import { GrammyError } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';

import type { Coordinates, Listing } from '@/modules/sources/source-adapter';

import { CAPTION_LIMIT_CHARS, MESSAGE_LIMIT_CHARS, listingCard } from './listing-card';

/** Telegram's hard cap on one media group — an eleventh photo is a rejected request. */
export const MAX_PHOTOS_PER_CARD = 10;

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
 * The card for one listing. Photos get the caption limit (a fifth of a message's), and a
 * listing without photos gets the full one.
 */
export function listingMessage(listing: Listing, position?: { index: number; total: number }) {
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
 * NOTE: the prototype found kufar's image CDN answering 302 (`rms.kufar.by` → `rms8…`), which
 * Telegram handles unpredictably in a media group (`WEBPAGE_MEDIA_EMPTY`). It never resolved
 * those redirects, and neither do we: up to ten HEAD requests per card to pre-empt a failure we
 * have not observed is a worse trade than falling back to text. The log below is what turns
 * that guess into evidence if it does happen.
 */
export async function sendCard(
  sender: CardSender,
  { caption, images, coordinates }: ListingMessage,
  logger: Logger,
): Promise<void> {
  const photos = images.slice(0, MAX_PHOTOS_PER_CARD);
  try {
    await withPhotos(sender, caption, photos);
  } catch (err) {
    // A blocked chat rejects the text too, and the run pauses the user on this error — a second
    // doomed request would only add another failure to report.
    if (photos.length === 0 || isBotBlocked(err)) throw err;
    logger.warn({ err }, 'Photo send failed — falling back to the text card');
    await sender.html(caption);
  }
  // The listing is already delivered, so a missing pin is not worth failing the delivery for.
  if (coordinates) {
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
