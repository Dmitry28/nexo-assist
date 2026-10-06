export type SourceId = 'kufar' | 'kufar-travel' | 'realt' | 'gsz' | 'rabota';

/**
 * Shown when a source gives no usable title. Part of the contract, not of one parser: `title` is
 * required, so every adapter needs the same answer to "the site sent none" — and the digest
 * dereferences it (telegram.format.ts), so an absent title is a crash, not a blank line.
 */
export const UNTITLED_LISTING = 'Объявление';

/**
 * The source did not give us usable HTML — an error status, a timeout, a network failure, a
 * response too large to accept, or a body that is not the page we asked for (a bot-wall, a
 * captcha, a redesign). Distinct from a bug in our code: triage and alerting treat them
 * differently (a site misbehaving is not something we can fix, but its volume still matters).
 *
 * The last case is why the parsers throw this too: a 200 carrying a challenge page is the
 * failure `kind: source` exists to name, and calling it our defect points triage at the wrong
 * party exactly when a source breaks for everyone.
 *
 * One caveat that follows from that: a site REDESIGN also lands here, and it is ours to fix —
 * the adapter needs updating — even though the tag says `source`. Those are the ones whose
 * message reads "page layout changed?"; `kind: source` means "the site did not hand us a usable
 * page", never "nothing to do".
 */
export class SourceUnavailableError extends Error {
  // Without this the issue title in Sentry reads "Error: HTTP 503" — the class name is what
  // makes the list scannable; the `kind` tag only helps once you are already filtering.
  // `: string`, not the literal — a subclass names itself (SearchRewrittenError).
  override readonly name: string = 'SourceUnavailableError';
}

/**
 * The site answered a different search than the one asked for: it redirected to another path.
 * realt does this to any URL carrying `addressV2` — the filter is dropped and the search widens
 * (17 listings became 1324, measured), which a silent redirect would hand to the user as theirs.
 * A SourceUnavailableError, since we got no usable page for that search; `to` is where it went,
 * so the user can be told what changed.
 */
export class SearchRewrittenError extends SourceUnavailableError {
  override readonly name = 'SearchRewrittenError';

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Search rewritten by a redirect: ${from} → ${to}`);
  }
}

/**
 * The window: a fetch returns at most this many newest listings, however the source sizes its
 * pages (`paginate` enforces it). MAX_SEEN_PER_SUBSCRIPTION is sized against it: a window wider
 * than the seen cap gets its own ids pruned and re-delivered as "new" every run — which is what
 * page-sized windows did on realt (see realt.adapter). 150 is what kufar's 5 × 30 always yields.
 */
export const MAX_LISTINGS = 150;

/**
 * What one `fetch` collected, and whether anything was lost along the way.
 *
 * `complete: false` means a page after the first failed to load or parse, so these listings are a
 * prefix of what the search actually holds. It is never an error by itself: page one carries the
 * newest listings, and a run that delivers those is a useful run. It matters to the caller that
 * treats a fetch as an inventory (the baseline) and to whoever needs to hear that a source
 * started breaking on page two while page one still works.
 *
 * A walk that stops at the window or the page cap is still `complete: true` — every page we meant
 * to read came back. That is what `capped` says instead: the source advertised more, and the window
 * may not have held everything published since the last run. Not a loss by itself; WatchService
 * calls it one only when nothing in the window was seen before. Conflating the two flags would make
 * `complete` fire on every large search and mean nothing.
 */
export interface FetchResult {
  listings: Listing[];
  complete: boolean;
  capped: boolean;
}

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
  /** A price the source states only as text (a salary range); when set, it wins over the numbers. */
  priceText?: string;
  address?: string;
  /** ISO 8601 timestamp of the last update/bump. */
  listTime: string;
  images: string[];
  /** Present only when the source published a pin. */
  coordinates?: Coordinates;
  /** Seller or contact name, when the source publishes one. */
  seller?: string;
  /** Source-specific facts. Empty when the source offers none — like `images`. */
  details: ListingDetail[];
}

/** A source plugin — the only place that knows about a specific site. */
export interface SourceAdapter {
  readonly id: SourceId;
  /**
   * Query params this adapter sets or strips itself (sort, paging). They do not name a search, so
   * the duplicate check drops them (SourceRegistry.volatileParams); the contract spec checks the
   * list covers what the adapter sends.
   */
  readonly volatileParams: readonly string[];
  /** Whether this adapter handles the given URL (host check). */
  matches(url: string): boolean;
  /** Fetch + parse the URL into normalized listings. */
  fetch(url: string): Promise<FetchResult>;
}
