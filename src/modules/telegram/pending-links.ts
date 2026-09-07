import { randomUUID } from 'node:crypto';

import type { SourceId } from '@/modules/sources/source-adapter';

// Bound for the pending-confirmation map — evict the oldest entry beyond this. Exported for specs.
export const MAX_PENDING = 500;

export interface PendingLink {
  userId: number;
  source: SourceId;
  url: string;
}

/**
 * Links awaiting a Subscribe/Cancel tap, keyed by a per-prompt nonce carried in callback_data
 * (too small for a URL) — so an old prompt can't subscribe a newer link.
 *
 * TODO [M]: eviction is global FIFO across all users, so one user pasting MAX_PENDING links
 * evicts every other user's open «Следить» prompt (they all get EXPIRED), and with no TTL a
 * restart silently expires everything. Key the cap per user and add a TTL.
 */
export class PendingLinks {
  private readonly pending = new Map<string, PendingLink>();

  add(link: PendingLink): string {
    // Evict the oldest entry at the cap (Map preserves insertion order).
    if (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    const nonce = randomUUID();
    this.pending.set(nonce, link);
    return nonce;
  }

  /** Resolve and consume the pending link for this nonce; null if expired or not the owner. */
  take(nonce: string | undefined, userId: number | undefined): PendingLink | null {
    const entry = nonce !== undefined ? this.pending.get(nonce) : undefined;
    if (nonce === undefined || !entry || entry.userId !== userId) return null;
    this.pending.delete(nonce);
    return entry;
  }
}
