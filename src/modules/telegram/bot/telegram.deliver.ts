import { wait } from '@/common/wait';
import type { Listing } from '@/modules/sources/source-adapter';

import type { ListingMessage } from './send-card';
import { SEND_DELAY_MS, isBotBlocked, listingMessage } from './send-card';
import { CARDS_PER_DELIVERY, tailBatches } from './telegram.format';

/** What actually reached the user, plus whatever went wrong around it. */
export interface DeliveryResult {
  delivered: Listing[];
  /**
   * The first send failure of the delivery. Reported, not fatal: the delivery goes on past it,
   * and only a blocked chat or a streak of failures ends the run early.
   */
  error?: unknown;
  /**
   * How many messages were refused. Only the first error is kept, so without this "one card of
   * thirty bounced" and "nine did" would read identically in the logs and in Sentry.
   */
  failures: number;
  /** Recording what arrived failed — the items resurface next run. */
  markSeenError?: unknown;
}

/** How a caller puts a delivery on the wire: a card per listing, a digest for the tail. */
// Consecutive failed sends that end a delivery. Small on purpose: it only has to tell "this one
// listing is bad" (isolated failures) from "the channel is not working right now" (every send
// fails), and the undelivered remainder goes out next run either way.
const MAX_CONSECUTIVE_FAILURES = 3;

export interface DeliveryTargets {
  card: (message: ListingMessage) => Promise<unknown>;
  /** Plain text, NOT HTML — the digest is not escaped (see telegram.format.ts). */
  digest: (text: string) => Promise<unknown>;
}

/** One message to send, and the listings it accounts for once it lands. */
interface DeliveryStep {
  listings: Listing[];
  send: () => Promise<unknown>;
}

/**
 * The messages one delivery consists of: a full card for the first CARDS_PER_DELIVERY listings,
 * then the rest as digest messages. Everything found goes out in the same run.
 */
function plan(fresh: Listing[], send: DeliveryTargets): DeliveryStep[] {
  const cards = fresh.slice(0, CARDS_PER_DELIVERY);
  return [
    ...cards.map((listing, i) => ({
      listings: [listing],
      send: () => send.card(listingMessage(listing, { index: i + 1, total: cards.length })),
    })),
    ...tailBatches(fresh.slice(CARDS_PER_DELIVERY)).map((batch) => ({
      listings: batch.listings,
      send: () => send.digest(batch.text),
    })),
  ];
}

/**
 * Send a delivery as however many messages it takes, paced, and report exactly what got through.
 *
 * The caller marks `delivered` as seen — never the whole list: if the third message of five
 * fails, the first two must not be re-sent tomorrow, and the rest must not be lost. The error is
 * returned rather than thrown so the caller can still persist that prefix.
 *
 * A failed message is skipped, not fatal. Undelivered items stay unmarked and come back next
 * run, so aborting here would let one listing Telegram keeps refusing silence the whole
 * subscription — on this run and on every run after it, since that listing leads the batch every
 * time. A blocked chat is the exception: it refuses everything that follows, and the run pauses
 * the user on exactly this error.
 *
 * A streak of failures is the other exception. One bad listing fails among successes; Telegram
 * being down fails everything, and carrying on would spend a full paced loop on requests that
 * cannot land — which under `/check` blocks every other user for as long as it takes.
 */
export async function deliverListings(
  fresh: Listing[],
  send: DeliveryTargets,
): Promise<DeliveryResult> {
  const delivered: Listing[] = [];
  let failure: unknown;
  let failures = 0;
  let streak = 0;

  for (const [i, step] of plan(fresh, send).entries()) {
    if (i > 0) await wait(SEND_DELAY_MS);
    try {
      await step.send();
    } catch (error) {
      failures += 1;
      if (isBotBlocked(error)) return { delivered, error, failures };
      // The first failure is the one reported: later ones are usually the same cause, and the
      // caller shows this to a user.
      failure ??= error;
      if (++streak >= MAX_CONSECUTIVE_FAILURES) return { delivered, error: failure, failures };
      continue;
    }
    streak = 0;
    delivered.push(...step.listings);
  }
  return { delivered, error: failure, failures };
}

/**
 * Deliver a digest and record what arrived — the send-then-markSeen step shared by the daily
 * run and /check.
 *
 * markSeen is isolated on purpose: the messages already reached the user, so failing to record
 * them is not a delivery failure — those items just resurface next run. Both failures are
 * returned rather than thrown, because only the caller knows what each one means for it.
 */
export async function deliverAndMark({
  listings,
  send,
  markSeen,
}: {
  listings: Listing[];
  send: DeliveryTargets;
  markSeen: (delivered: Listing[]) => Promise<void>;
}): Promise<DeliveryResult> {
  const result = await deliverListings(listings, send);

  // Persist whatever reached the user, even if a later message failed — otherwise the whole
  // digest would be re-sent next run.
  if (result.delivered.length === 0) return result;
  try {
    await markSeen(result.delivered);
  } catch (markSeenError) {
    return { ...result, markSeenError };
  }
  return result;
}
