import type { Logger } from '@nestjs/common';
import { GrammyError } from 'grammy';
import type { Api, InputFile } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';

import { wait } from '@/common/wait';
import type { Coordinates, Listing } from '@/modules/sources/source-adapter';

import type { CardPosition } from './listing-card';
import { CAPTION_LIMIT_CHARS, MESSAGE_LIMIT_CHARS, listingCard } from './listing-card';
import { downloadPhoto } from './photo-upload';
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
  /**
   * The source's host — the one site a photo Telegram refused may be downloaded from
   * (photo-upload.ts). The source's, not the listing link's: a parser builds that link from the
   * page. Absent, nothing is downloaded.
   */
  site?: string;
  coordinates?: Coordinates;
}

/**
 * Where a card goes. Two implementations exist on purpose: the scheduled run sends through the
 * bot API to a stored chat id, while /check replies inside the update it is handling — and
 * wiring the service into the handlers would close the DI cycle documented in
 * `src/__tests__/di-wiring.spec.ts`.
 */
export interface CardSender {
  /** By URL, or a file we downloaded when Telegram could not fetch the URL itself. */
  photo(photo: string | InputFile, caption: string): Promise<unknown>;
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
    photo: (photo, caption) => api.sendPhoto(chatId, photo, { caption, parse_mode: 'HTML' }),
    group: (media) => api.sendMediaGroup(chatId, media),
    html: (text) =>
      api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: NO_LINK_PREVIEW }),
    location: ({ lat, lon }) => api.sendLocation(chatId, lat, lon),
  };
}

/**
 * The card for one listing. Photos get the caption limit (a fifth of a message's), and a
 * listing without photos gets the full one.
 *
 * TODO [L]: when the photo send fails, the text fallback re-uses this caption, so it stays cut
 * to 1024 chars where a standalone message allows 4096 — routine for idriver's newest offers,
 * whose photos the site does not serve. Fixing it means carrying the listing (or both variants)
 * through to `sendCard`.
 */
export function listingMessage(
  listing: Listing,
  position?: CardPosition,
  site?: string,
): ListingMessage {
  const limit = listing.images.length > 0 ? CAPTION_LIMIT_CHARS : MESSAGE_LIMIT_CHARS;
  return {
    caption: listingCard(listing, limit, position),
    images: listing.images,
    site,
    coordinates: listing.coordinates,
  };
}

/**
 * Send one listing: its photos carry the card. Photos Telegram refuses by URL are uploaded as
 * files instead (uploadInstead); what still fails falls back to a plain message.
 * Resolves once the listing has reached the user in some form — callers mark seen on that, so
 * anything that leaves it undelivered throws instead.
 *
 * NOTE: kufar's image CDN answers 302 (`rms.kufar.by` → a `rms2…` shard), and Telegram sometimes
 * fails on it — seen in prod 2026-10-23…25, mostly one item of an album (`WEBPAGE_CURL_FAILED`).
 * We do not pre-resolve (up to ten HEAD requests per card, against a shard host we would then be
 * pinning): the upload below follows the redirect itself, and `onPhotoFallback` counts the cards
 * that still go out as text — a metric, because a pod's log cannot answer "is this systematic?".
 */
export async function sendCard(
  sender: CardSender,
  { caption, images, site, coordinates }: ListingMessage,
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
    // A 400 is a refused request — here the photo, since captions are escaped and cut to the
    // limit. Any other error (Telegram's own outage) would fail an upload too.
    const refused = err instanceof GrammyError && err.error_code === 400;
    if (
      refused &&
      site !== undefined &&
      (await uploadInstead({ sender, caption, photos, site, logger }))
    ) {
      return pin(sender, coordinates, logger);
    }
    // TODO [L]: the fallback re-sends the same HTML with the same parse_mode, so it cannot save
    // a card Telegram refused for its markup — only one refused for its photos. No such markup
    // is reachable today (everything scraped is escaped, and the only source-controlled URL is
    // validated in kufar.parser.ts), so a plain-text last resort would be error handling for a
    // path that cannot happen. Add it if a caption ever does get refused.
    logger.warn({ err }, 'Photo send failed — falling back to the text card');
    onPhotoFallback?.();
    // Paced like every other message to this chat: the refused send still counted against the
    // per-chat limit, and this retry is what actually delivers the listing.
    await wait(SEND_DELAY_MS);
    await sender.html(caption);
  }
  await pin(sender, coordinates, logger);
}

/**
 * Photos Telegram could not fetch by URL, sent again as files we downloaded — some CDNs refuse
 * Telegram's fetcher but serve us (photo-upload.ts). A photo the site does not serve is dropped;
 * none left means the text fallback. Whether the card landed; a blocked chat still throws, like
 * every send.
 * TODO [L]: a source that always refuses Telegram (idriver) pays a doomed URL send and a pace
 * per card before the upload — a per-source «upload first» flag, if run time starts to matter.
 * NOTE: a card saved this way is not a photo fallback — `onPhotoFallback` counts text cards only,
 * so a CDN that starts refusing Telegram shows up here as log lines, not in that metric.
 */
async function uploadInstead({
  sender,
  caption,
  photos,
  site,
  logger,
}: {
  sender: CardSender;
  caption: string;
  photos: string[];
  site: string;
  logger: Logger;
}): Promise<boolean> {
  const downloads = await Promise.all(
    photos.map((url) =>
      downloadPhoto(url, site).catch((err: unknown) => {
        // Not a warn: a photo the site itself does not serve (a 404) is routine, and the
        // text fallback that follows warns and counts already. This line says why it missed.
        logger.log({ err }, `Photo not uploaded: ${url}`);
        return undefined;
      }),
    ),
  );
  const files = downloads.filter((file) => file !== undefined);
  if (files.length === 0) return false;
  try {
    // Paced: the refused send counted against the per-chat limit.
    await wait(SEND_DELAY_MS);
    await withPhotos(sender, caption, files);
    logger.log(
      `${files.length} of ${photos.length} photos uploaded after Telegram refused: ${photos[0]}`,
    );
    return true;
  } catch (err) {
    if (isBotBlocked(err)) throw err;
    logger.log({ err }, `Photos not uploaded: ${photos[0]}`);
    return false;
  }
}

// The listing is already delivered, so a missing pin is not worth failing the delivery for.
// Log-only, unlike the photo fallback: a pin carries no information the card lacks (the address
// is in it), so a systematic pin failure changes nothing anyone would act on.
async function pin(
  sender: CardSender,
  coordinates: Coordinates | undefined,
  logger: Logger,
): Promise<void> {
  if (!coordinates) return;
  await wait(SEND_DELAY_MS);
  await sender
    .location(coordinates)
    .catch((err: unknown) => logger.warn({ err }, 'Location pin failed'));
}

function withPhotos(
  sender: CardSender,
  caption: string,
  photos: Array<string | InputFile>,
): Promise<unknown> {
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
