import { randomUUID } from 'node:crypto';

import type { SourceId } from '@/modules/sources/source-adapter';

// Open «Следить» prompts one user may hold. A person never has more than a couple; the cap only
// keeps one user from growing the map without bound. Exported for specs.
export const MAX_PENDING_PER_USER = 20;

// How long a prompt stays tappable. Generous on purpose — a link pasted now and answered in the
// evening must still work; the point is only that abandoned prompts don't sit in memory forever.
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingLink {
  userId: number;
  source: SourceId;
  url: string;
}

interface Entry {
  link: PendingLink;
  addedAt: number;
}

/**
 * Links awaiting a Subscribe/Cancel tap, keyed by a per-prompt nonce carried in callback_data
 * (too small for a URL) — so an old prompt can't subscribe a newer link.
 *
 * The cap is per user, not global: a global one lets whoever pastes the most links expire
 * everyone else's open prompt. That gives up the absolute ceiling a global cap had — the bound
 * is now MAX_PENDING_PER_USER × everyone who pasted a link inside the TTL — and it is worth it
 * at these volumes: an entry is ~150 bytes, and it takes a real Telegram account to add one.
 *
 * The map is process-local, so a restart expires every prompt and a second replica would split
 * it — one of the reasons the app runs a single replica (k8s/deployment.yaml).
 */
export class PendingLinks {
  private readonly pending = new Map<string, Entry>();

  /** Prompts currently held. Exists for the specs: the expiry sweep has no other visible
   *  effect, and without a test on it nothing would catch its removal. */
  get size(): number {
    return this.pending.size;
  }

  add(link: PendingLink): string {
    this.dropExpired();
    this.makeRoomFor(link.userId);
    const nonce = randomUUID();
    this.pending.set(nonce, { link, addedAt: Date.now() });
    return nonce;
  }

  /** Resolve and consume the pending link for this nonce; null if expired or not the owner. */
  take(nonce: string | undefined, userId: number | undefined): PendingLink | null {
    const entry = nonce !== undefined ? this.pending.get(nonce) : undefined;
    if (nonce === undefined || !entry || entry.link.userId !== userId) return null;
    this.pending.delete(nonce);
    // Checked on the way out too: nothing else runs between two taps, so an expired prompt
    // would otherwise stay usable until the next paste triggers a sweep.
    return this.isExpired(entry) ? null : entry.link;
  }

  private isExpired({ addedAt }: Entry): boolean {
    return Date.now() - addedAt >= PENDING_TTL_MS;
  }

  /** One uniform TTL plus insertion order means the expired entries are a prefix — stop at the
   *  first live one. */
  private dropExpired(): void {
    for (const [nonce, entry] of this.pending) {
      if (!this.isExpired(entry)) return;
      this.pending.delete(nonce);
    }
  }

  /**
   * Evict this user's oldest prompts so their next one fits inside their own cap.
   *
   * NOTE: scans the whole map, once per pasted link. A nonce index per user would make that O(1)
   * at the cost of a second structure to keep in step; at a few thousand entries the scan does
   * not register.
   */
  private makeRoomFor(userId: number): void {
    const own = [...this.pending]
      .filter(([, { link }]) => link.userId === userId)
      .map(([nonce]) => nonce);
    const excess = own.length - (MAX_PENDING_PER_USER - 1);
    for (let i = 0; i < excess; i++) this.pending.delete(own[i]);
  }
}
