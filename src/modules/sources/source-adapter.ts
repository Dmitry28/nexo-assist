export type SourceId = 'kufar' | 'realt';

/**
 * Shown when a source gives no usable title. Part of the contract, not of one parser: `title` is
 * required, so every adapter needs the same answer to "the site sent none" — and the digest
 * dereferences it (telegram.format.ts), so an absent title is a crash, not a blank line.
 */
export const UNTITLED_LISTING = 'Объявление';

/** A normalized listing — the shared shape every adapter produces. */
export interface Listing {
  /** Stable per-source id — the diff/dedup key. */
  externalId: string;
  link: string;
  title: string;
  description?: string;
  priceByn?: number;
  priceUsd?: number;
  address?: string;
  /** ISO 8601 timestamp of the last update/bump. */
  listTime: string;
  images: string[];
}

/** A source plugin — the only place that knows about a specific site. */
export interface SourceAdapter {
  readonly id: SourceId;
  /** Whether this adapter handles the given URL (host check). */
  matches(url: string): boolean;
  /** Fetch + parse the URL into normalized listings. */
  fetch(url: string): Promise<Listing[]>;
}
