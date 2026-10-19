import type { SOURCES } from './sources';

/** Every registered source's id — derived, so registering a source is the only edit. */
export type SourceId = (typeof SOURCES)[number]['id'];

/**
 * Shown when a source gives no usable title. Part of the contract, not of one parser: `title` is
 * required, so every source needs the same answer to "the site sent none" — and the digest
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
 * the source's parser needs updating — even though the tag says `source`. Those are the ones whose
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
 * The pasted search names filters we cannot honour on the path we would take (bid.cars closed →
 * Copart/IAAI). Not an outage: following through would watch a wider search than the link.
 * TODO [M]: subscribe refuses this; the daily poll still counts it as an outage.
 */
export class UnsupportedSearchError extends SourceUnavailableError {
  override readonly name = 'UnsupportedSearchError';

  constructor(
    readonly url: string,
    readonly params: readonly string[],
  ) {
    super(`Unsupported search params: ${params.join(', ')}`);
  }
}

/**
 * The site answered 404 — kept as its own class so a caller that knows the page can tell the site
 * saying «no such listing» from a broken URL (the body is the evidence). Everyone else sees an
 * ordinary SourceUnavailableError.
 */
export class PageNotFoundError extends SourceUnavailableError {
  override readonly name = 'PageNotFoundError';
  // Private, behind a getter: the error serializer copies own fields into the log line, and this
  // is a whole page (up to MAX_HTML_LENGTH) on every 404 of every source.
  readonly #html: string;

  constructor(url: string, html: string) {
    super(`HTTP 404 for ${url}`);
    this.#html = html;
  }

  get html(): string {
    return this.#html;
  }
}

/** The watched listing was already gone when the user subscribed — nothing to watch. */
export class ListingGoneError extends SourceUnavailableError {
  override readonly name = 'ListingGoneError';
}

/**
 * A protected source could not be read because none of the paid anti-bot services could be asked
 * — no key configured, or every one spent for the month. Our side, not the link and not the site:
 * the scheduler does not count it against the subscription (a dead-link pause would tell the
 * user «Проверьте ссылку» — false) and tells the owner once per run instead.
 */
export class PaidRungsUnavailableError extends SourceUnavailableError {
  override readonly name = 'PaidRungsUnavailableError';
}

/**
 * The window: a fetch returns at most this many newest listings, however the source sizes its
 * pages (`paginate` enforces it). MAX_SEEN_PER_SUBSCRIPTION is sized against it: a window wider
 * than the seen cap gets its own ids pruned and re-delivered as "new" every run — which is what
 * page-sized windows did on realt (see realt.parser parsePage). 500 is the owner's call
 * (2026-10-15): a busy search must not publish past the window between two daily runs.
 */
export const MAX_LISTINGS = 500;

/**
 * What one `fetch` collected, and whether anything was lost along the way.
 *
 * `complete: false` means a page after the first failed to load or parse — or some item-page visits
 * failed and those listings were held back for the next poll — so these listings are a
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
  /**
   * A watched single listing (an item link): the site said outright that it no longer exists.
   * The one way a listing is ever called removed without a complete list to miss it from — an
   * explicit answer, never a page that just came back empty.
   */
  gone?: true;
}

/** A map pin: latitude/longitude as the source published them. */
export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * One labelled fact about a listing, in display order. The source's parser owns the wording and the
 * unit — it is the only place that knows «Участок 12 сот.» from «Пробег 120 000 км», so the
 * card can render any vertical without learning its vocabulary (build them with
 * `listing-details.ts`).
 */
export interface ListingDetail {
  label: string;
  value: string;
}

/** A normalized listing — the shared shape every source produces. */
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

/**
 * Which daily credit budget a protected source's polls draw on: a site with a country is paid by
 * the providers that can place a request there, one without by the others (scraping/providers.ts).
 */
export type CreditPool = 'geo' | 'global';

/** A source plugin — the only place that knows about a specific site. */
export interface SourceAdapter {
  readonly id: SourceId;
  /** Query params that name no search on this source — the duplicate check drops them. */
  readonly volatileParams: readonly string[];
  /** A listing gone from a complete fetch was sold — tell the user (see SourceDefinition). */
  readonly reportsRemoved: boolean;
  /**
   * What one poll may cost on the paid rungs, and which budget pays it — undefined for an
   * unprotected source (subscriptions.service.ts § DAILY_CREDIT_BUDGET).
   */
  readonly paidPoll?: { credits: number; pool: CreditPool };
  /** Whether this adapter handles the given URL (host check). */
  matches(url: string): boolean;
  /**
   * Fetch + parse the URL into normalized listings. `idsOnly`: the caller needs only ids (the
   * baseline on subscribe) — a source may skip work that only fills fields (item-page visits).
   */
  fetch(url: string, options?: { idsOnly?: boolean }): Promise<FetchResult>;
}
