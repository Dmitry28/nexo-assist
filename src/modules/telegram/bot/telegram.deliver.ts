import { wait } from '@/common/wait';
import type { Listing } from '@/modules/sources/source-adapter';

import type { ListingMessage } from './send-card';
import { SEND_DELAY_MS, listingMessage } from './send-card';
import { CARDS_PER_DELIVERY, tailBatches } from './telegram.format';

/** What actually reached the user, plus whatever went wrong around it. */
export interface DeliveryResult {
  delivered: Listing[];
  /** The send failure that stopped the rest, if any. */
  error?: unknown;
  /** Recording what arrived failed — the items resurface next run. */
  markSeenError?: unknown;
}

/** How a caller puts a delivery on the wire: a card per listing, a digest for the tail. */
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
 */
export async function deliverListings(
  fresh: Listing[],
  send: DeliveryTargets,
): Promise<DeliveryResult> {
  const delivered: Listing[] = [];

  for (const [i, step] of plan(fresh, send).entries()) {
    if (i > 0) await wait(SEND_DELAY_MS);
    try {
      await step.send();
    } catch (error) {
      return { delivered, error };
    }
    delivered.push(...step.listings);
  }
  return { delivered };
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
