export type SourceId = 'kufar' | 'realt';

/**
 * Shown when a source gives no usable title. Part of the contract, not of one parser: `title` is
 * required, so every adapter needs the same answer to "the site sent none" — and the digest
 * dereferences it (telegram.format.ts), so an absent title is a crash, not a blank line.
 */
export const UNTITLED_LISTING = 'Объявление';

/** A map pin: latitude/longitude as the source published them. */
export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * One labelled fact about a listing, in display order. The adapter owns the wording and the
 * unit — it is the only place that knows «Участок 12 сот.» from «Пробег 120 000 км», so the
 * card can render any vertical without learning its vocabulary (build them with
 * `listing-details.ts`).
 */
export interface ListingDetail {
  label: string;
  value: string;
}

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
  /** Present only when the source published a pin — realt, for one, never does. */
  coordinates?: Coordinates;
  /** Seller or contact name, when the source publishes one. */
  seller?: string;
  /** Source-specific facts. Empty when the source offers none — like `images`. */
  details: ListingDetail[];
}

/** A source plugin — the only place that knows about a specific site. */
export interface SourceAdapter {
  readonly id: SourceId;
  /** Whether this adapter handles the given URL (host check). */
  matches(url: string): boolean;
  /** Fetch + parse the URL into normalized listings. */
  fetch(url: string): Promise<Listing[]>;
}
