import { Logger } from '@nestjs/common';

import { matchesHost, withParam, withoutParam } from '@/common/url';

import { fetchHtml } from './scraping/http';
import { fetchProtected } from './scraping/ladder';
import type { Protection } from './scraping/ladder';
import { paginate } from './scraping/paginate';
import { mapPool } from './scraping/pool';
import { pageCredits, poolOf } from './scraping/providers';
import { PageNotFoundError, SourceUnavailableError } from './source-adapter';
import type { FetchResult, Listing, PaidPoll, SourceAdapter, SourceId } from './source-adapter';

/** A fetch pinned to the source's host and proxy — what `load` and `enrich` get to work with. */
export type Get = (url: string) => Promise<string>;

// At most this many item-page visits at once: polite to the small sites that need them. With the
// 30 s fetch timeout, 25 lots on a slow site can take minutes — the baseline skips the visits.
const ENRICH_CONCURRENCY = 2;

/** What a parser is told about the page it reads. */
export interface PageContext {
  /** The search URL as the user pasted it. */
  url: string;
  /** Which page of the walk this is, 1-based — the factory converts it to the site's number. */
  page: number;
  /** One clock per fetch, for sites that print only relative times. */
  now: Date;
  /** Raw items the site sent on the pages before this one (realt counts against its total). */
  sent: number;
}

/** One parsed page: its listings and what leads to the next one. */
export interface SearchPage<Next> {
  listings: Listing[];
  next: Next;
  /** Raw items this page carried, when parsing dropped some (defaults to listings.length). */
  sent?: number;
}

interface CommonDefinition<Id extends string> {
  /** Stored with every subscription — never rename one that is live. */
  id: Id;
  host: string;
  /** A real search URL on this host and path — the contract spec runs every source against it. */
  sample: string;
  /** What the site offers, in a few words, for the bot's list of sites («вакансии»). */
  about: string;
  /**
   * The search page's path (trailing slash optional), when other pages of the host are no search —
   * a pattern (no `g`/`y` flag — `test` would keep state) when the path carries the search itself
   * (gridom's `/<developer>`).
   */
  searchPath?: string | RegExp;
  /**
   * Where the data for a pasted link really lives, when that is not the page itself — a JSON
   * endpoint behind a widget. Must stay on `host`. Matching and the duplicate check keep the
   * pasted link.
   */
  requestUrl?(url: string): string;
  /**
   * Params forced on every request — newest-first sort, the page size.
   * NOTE: these, the paging param and `noise` are what the duplicate check drops from this source's
   * links — changing them changes stored `normalizedUrl`s, so it ships with a re-normalizing
   * migration (precedent: RenormalizeSubscriptionUrls).
   */
  pins?: Readonly<Record<string, string>>;
  /** Per-visit noise a pasted link carries that names no search (hh's `hhtmFrom`…). */
  noise?: readonly string[];
  /** Route through SCRAPE_PROXY_URL — only for a site measured to block datacenter IPs. */
  useProxy?: boolean;
  /**
   * The body to parse, when the pasted page is only the way to it — a JSON POST (Copart), a
   * separate grid request (gcn). `get` fetches on this source's host, through its proxy if any.
   */
  load?: (url: string, get: Get) => Promise<string>;
  /**
   * Behind anti-bot protection: every request climbs the fetch ladder (scraping/ladder.ts), paid
   * rungs included — so its polls draw on its pool's DAILY_CREDIT_BUDGET. One request per poll: a
   * single page, no `load`, no `enrich` (each would be another paid page); no `pinPath` (the paid
   * rungs follow redirects on their side).
   */
  protection?: Protection;
  /**
   * What one poll may cost, for a source whose `load` climbs the fetch ladder itself (Copart's
   * POST): its pages × the price of one — so its subscriptions count against DAILY_CREDIT_BUDGET.
   * A `protection` source gets its own computed; never both.
   */
  paidPoll?: PaidPoll;
  /** Fail on a redirect to another path — for sites that rewrite a search (see fetchHtml). */
  pinPath?: boolean;
  /**
   * A listing leaving the page means it was sold — a fixed sale list (ghb, prometr, gridom). Not
   * for an archive (auction notices) nor a search, where listings fall out of the window by age.
   */
  reportsRemoved?: true;
  /** A link to one listing is watched for its price and removal (PRODUCT.md § Одно объявление). */
  item?: ItemDefinition;
}

/** What an item's `parse` returns when the live page itself says the listing is gone. */
export const GONE = Symbol('gone');

/** How a source reads a link to a single listing instead of a search. */
interface ItemDefinition {
  /**
   * The listing an item link names — its id and its one canonical address (stored, so two forms
   * of a link dedup); null when the link is no item page (a search).
   */
  match(url: string): { id: string; url: string } | null;
  /**
   * The listing on its live page (`url`: the stored item link), or GONE when that page says it is
   * closed (rabota's archived vacancy). Throws SourceUnavailableError on a page it cannot read.
   */
  parse(html: string, url: string): Listing | typeof GONE;
  /** Whether a 404 page is the site saying the listing is gone — not a broken or moved URL. */
  isGone(notFoundHtml: string): boolean;
}

/** A site that numbers its pages, counting from `first`; `next` says whether another follows. */
interface PagedDefinition<Id extends string> extends CommonDefinition<Id> {
  page: { param: string; first: number };
  parse(html: string, ctx: PageContext): SearchPage<boolean>;
}

/** A site that hands back a cursor token for the next page; `next` is it, or null at the end. */
interface CursorDefinition<Id extends string> extends CommonDefinition<Id> {
  cursor: { param: string };
  parse(html: string, ctx: PageContext): SearchPage<string | null>;
}

/** A site watched as one fixed page — a price list, a notice board: no paging at all. */
interface SinglePageDefinition<Id extends string> extends CommonDefinition<Id> {
  /** Said out loud: a paged source that forgot `page` must not compile as a single page. */
  singlePage: true;
  /**
   * An item-page visit for a field the list lacks (gcn's price). A listing whose visit fails is
   * held back this run — delivered, it would be marked seen and never come back with the field —
   * and retried next poll. Every item, every poll (PRODUCT_PLAN.md § Фаза 5.6, 2б).
   */
  enrich?: (listing: Listing, get: Get) => Promise<Listing>;
  parse(html: string, ctx: PageContext): Omit<SearchPage<never>, 'next'>;
}

/**
 * A source, declared: everything here is knowledge of one site. `createSourceAdapters` turns it
 * into a SourceAdapter — matching, pinning, paging and the duplicate-check params are shared.
 * The default id is for the shared code that takes any registered source.
 */
export type SourceDefinition<Id extends string = SourceId> =
  PagedDefinition<Id> | CursorDefinition<Id> | SinglePageDefinition<Id>;

/**
 * Declare a source, keeping its `id` as a literal: `SourceId` is derived from the registered
 * definitions (sources.ts), so a new source needs no edit of a shared union.
 */
export const defineSource = <const Id extends string>(
  definition: SourceDefinition<Id>,
): SourceDefinition<Id> => definition;

const trimSlash = (path: string): string => path.replace(/\/+$/, '');

/**
 * Adapters for a set of definitions. Built together because matching needs the whole set: a
 * host another definition owns as a subdomain (travel.kufar.by under kufar.by) is that one's,
 * so two adapters never claim one link — the contract spec holds every sample to it.
 */
export function createSourceAdapters(definitions: readonly SourceDefinition[]): SourceAdapter[] {
  return definitions.map((def) => {
    // A protected poll must cost one paid page: a single page (the literal `singlePage: true`), no
    // second request for the list, no item visits.
    if (def.protection && def.paidPoll) {
      throw new Error(`${def.id}: protection computes its own paidPoll — declare one or the other`);
    }
    if (
      def.protection &&
      (!('singlePage' in def) || 'load' in def || 'enrich' in def || def.pinPath || def.item)
    ) {
      // `item` too: fetchItem takes the plain fetch, so a protected item page would skip the ladder.
      throw new Error(
        `${def.id}: protection takes one plain page — no paging, load, enrich, pinPath, item`,
      );
    }
    const subHosts = definitions
      .map((other) => other.host)
      .filter((host) => host !== def.host && host.endsWith(`.${def.host}`));
    const { searchPath } = def;
    const onSearchPath = (url: string): boolean => {
      if (searchPath === undefined) return true;
      const path = trimSlash(new URL(url).pathname);
      return typeof searchPath === 'string'
        ? path === trimSlash(searchPath)
        : searchPath.test(path);
    };
    const pagingParam = pagingParamOf(def);
    const logger = new Logger(`source:${def.id}`);
    return {
      id: def.id,
      volatileParams: [
        ...Object.keys(def.pins ?? {}),
        ...(pagingParam === undefined ? [] : [pagingParam]),
        ...(def.noise ?? []),
      ],
      // matchesHost first: it rejects what `new URL` would throw on.
      matches: (url) =>
        matchesHost({ url, host: def.host }) &&
        !subHosts.some((host) => matchesHost({ url, host })) &&
        (onSearchPath(url) || isItem(def, url)),
      reportsRemoved: def.reportsRemoved === true,
      // The worst case — the free rungs only make the real spend lower.
      paidPoll:
        def.paidPoll ??
        (def.protection && { credits: pageCredits(def.protection), pool: poolOf(def.protection) }),
      readsOnePage: def.protection !== undefined,
      fetch: (url, options) =>
        def.item && isItem(def, url)
          ? fetchItem(def, def.item, url)
          : fetchSearch(def, url, pagingParam, logger, options),
    };
  });
}

const isItem = (def: SourceDefinition, url: string): boolean => Boolean(def.item?.match(url));

/**
 * One listing's page: the listing, or `gone` only when the site says so — its own 404 (`isGone`)
 * or the live page itself (`parse` → GONE, rabota's archived vacancy). Any other
 * failure stays a SourceUnavailableError: an outage must never read as «removed». No `pinPath`:
 * item pages redirect to their full address by design (kufar /vi/<id> → /vi/<city>/…/<id>).
 */
async function fetchItem(
  def: SourceDefinition,
  item: ItemDefinition,
  url: string,
): Promise<FetchResult> {
  try {
    const html = await fetchHtml({ url, host: def.host, useProxy: def.useProxy });
    const listing = item.parse(html, url);
    return listing === GONE
      ? { listings: [], complete: true, capped: false, gone: true }
      : { listings: [listing], complete: true, capped: false };
  } catch (err) {
    if (err instanceof PageNotFoundError && item.isGone(err.html)) {
      return { listings: [], complete: true, capped: false, gone: true };
    }
    throw err;
  }
}

const requested = (def: SourceDefinition, url: string): string => def.requestUrl?.(url) ?? url;

function pagingParamOf(def: SourceDefinition): string | undefined {
  if ('singlePage' in def) return undefined;
  return 'cursor' in def ? def.cursor.param : def.page.param;
}

function fetchSearch(
  def: SourceDefinition,
  url: string,
  pagingParam: string | undefined,
  logger: Logger,
  options?: { idsOnly?: boolean },
): Promise<FetchResult> {
  // A pasted page or cursor would start mid-list and skip the newest listings.
  const base = Object.entries(def.pins ?? {}).reduce(
    (next, [key, value]) => withParam(next, key, value),
    pagingParam === undefined
      ? requested(def, url)
      : withoutParam(requested(def, url), pagingParam),
  );
  // Page N of the walk is the site's `first + N - 1` (rabota counts from 0, the rest from 1).
  const pageUrl = (n: number): string =>
    'page' in def ? withParam(base, def.page.param, String(def.page.first + n - 1)) : base;
  const load = 'load' in def ? def.load : undefined;
  const enrich = 'enrich' in def ? def.enrich : undefined;
  const now = new Date();
  const { host, useProxy, protection } = def;
  const get: Get = (target) =>
    protection
      ? fetchProtected({ url: target, host, useProxy, protection })
      : fetchHtml({ url: target, host, useProxy });
  // Per call, not per adapter: the adapter is shared by concurrent polls.
  let sent = 0;
  const walk = paginate({
    firstUrl: pageUrl(1),
    host: def.host,
    parsePage: (html, page) => {
      const parsed = def.parse(html, { url, page, now, sent });
      const { listings, sent: raw } = parsed;
      sent += raw ?? listings.length;
      const next = 'next' in parsed ? parsed.next : undefined;
      // An empty token, `false` or a single page alike: no page follows (the param check is also
      // what narrows `pagingParam` for the URL below).
      if (!next || pagingParam === undefined) return { listings, nextUrl: null };
      return {
        listings,
        nextUrl: typeof next === 'string' ? withParam(base, pagingParam, next) : pageUrl(page + 1),
      };
    },
    logger,
    useProxy: def.useProxy,
    pinPath: def.pinPath,
    // A protected page is fetched through the ladder; paginate's own fetch is the plain one.
    load: load ? (target) => load(target, get) : protection ? get : undefined,
  });
  return enrich && !options?.idsOnly
    ? walk.then((result) => visitItems(result, enrich, get, logger))
    : walk;
}

async function visitItems(
  result: FetchResult,
  visit: NonNullable<SinglePageDefinition<string>['enrich']>,
  get: Get,
  logger: Logger,
): Promise<FetchResult> {
  const visited = await mapPool(result.listings, ENRICH_CONCURRENCY, (listing) =>
    // Through a promise, so a visit that throws synchronously is held back like one that rejects.
    Promise.resolve()
      .then(() => visit(listing, get))
      .catch((err: unknown) => {
        logger.warn({ err }, `Item page failed for ${listing.link}`);
        return undefined;
      }),
  );
  const listings = visited.filter((listing) => listing !== undefined);
  const held = visited.length - listings.length;
  // Every visit failing while the list loaded is the site breaking, not a flaky item.
  if (held > 0 && listings.length === 0) {
    throw new SourceUnavailableError(`all ${held} item pages failed`);
  }
  if (held > 0) logger.warn(`${held} of ${visited.length} item pages failed — retried next poll`);
  // Some listings held back is a loss this run, like a failed later page.
  return { ...result, listings, complete: result.complete && held === 0 };
}
