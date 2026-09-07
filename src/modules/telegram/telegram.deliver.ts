import { wait } from '@/common/wait';
import type { Listing } from '@/modules/sources/source-adapter';

import type { DigestBatch } from './telegram.format';
import { newListingsBatches } from './telegram.format';

// Pause between messages to one chat. Telegram tolerates about one per second per chat; the
// auto-retry plugin would survive a 429 anyway, but waiting is cheaper than being rate-limited.
export const SEND_DELAY_MS = 1000;

/** What actually reached the user, plus whatever went wrong around it. */
export interface DeliveryResult {
  delivered: Listing[];
  /** The send failure that stopped the rest, if any. */
  error?: unknown;
  /** Recording what arrived failed — the items resurface next run. */
  markSeenError?: unknown;
}

/**
 * Send a digest as however many messages it takes, paced, and report exactly what got through.
 *
 * The caller marks `delivered` as seen — never the whole batch list: if the third message of
 * five fails, the first two must not be re-sent tomorrow, and the rest must not be lost. The
 * error is returned rather than thrown so the caller can still persist that prefix.
 */
export async function deliverDigest(
  fresh: Listing[],
  send: (text: string) => Promise<unknown>,
): Promise<DeliveryResult> {
  const batches: DigestBatch[] = newListingsBatches(fresh);
  const delivered: Listing[] = [];

  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(SEND_DELAY_MS);
    try {
      await send(batch.text);
    } catch (error) {
      return { delivered, error };
    }
    delivered.push(...batch.listings);
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
  send: (text: string) => Promise<unknown>;
  markSeen: (delivered: Listing[]) => Promise<void>;
}): Promise<DeliveryResult> {
  const result = await deliverDigest(listings, send);

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
