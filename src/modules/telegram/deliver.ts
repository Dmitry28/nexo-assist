import type { Listing } from '@/modules/sources/source-adapter';

import type { DigestBatch } from './telegram.format';
import { newListingsBatches } from './telegram.format';

// Pause between messages to one chat. Telegram tolerates about one per second per chat; the
// auto-retry plugin would survive a 429 anyway, but waiting is cheaper than being rate-limited.
export const SEND_DELAY_MS = 1000;

/** What actually reached the user, plus the failure that stopped the rest (if any). */
export interface DeliveryResult {
  delivered: Listing[];
  error?: unknown;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
