import { Logger } from '@nestjs/common';

import { matchesHost, withParam, withoutParam } from '@/common/url';

import { paginate } from './scraping/paginate';
import type { FetchResult, Listing, SourceAdapter, SourceId } from './source-adapter';

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
  /** The search page's path (trailing slash optional), when other pages of the host are no search. */
  searchPath?: string;
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
  /** Fail on a redirect to another path — for sites that rewrite a search (see fetchHtml). */
  pinPath?: boolean;
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

/**
 * A source, declared: everything here is knowledge of one site. `createSourceAdapters` turns it
 * into a SourceAdapter — matching, pinning, paging and the duplicate-check params are shared.
 */
// The default is for the shared code that takes any registered source.
export type SourceDefinition<Id extends string = SourceId> =
  PagedDefinition<Id> | CursorDefinition<Id>;

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
    const subHosts = definitions
      .map((other) => other.host)
      .filter((host) => host !== def.host && host.endsWith(`.${def.host}`));
    const searchPath = def.searchPath === undefined ? undefined : trimSlash(def.searchPath);
    const pagingParam = 'cursor' in def ? def.cursor.param : def.page.param;
    const logger = new Logger(`source:${def.id}`);
    return {
      id: def.id,
      volatileParams: [...Object.keys(def.pins ?? {}), pagingParam, ...(def.noise ?? [])],
      // matchesHost first: it rejects what `new URL` would throw on.
      matches: (url) =>
        matchesHost({ url, host: def.host }) &&
        !subHosts.some((host) => matchesHost({ url, host })) &&
        (searchPath === undefined || trimSlash(new URL(url).pathname) === searchPath),
      fetch: (url) => fetchSearch(def, url, pagingParam, logger),
    };
  });
}

function fetchSearch(
  def: SourceDefinition,
  url: string,
  pagingParam: string,
  logger: Logger,
): Promise<FetchResult> {
  // A pasted page or cursor would start mid-list and skip the newest listings.
  const base = Object.entries(def.pins ?? {}).reduce(
    (next, [key, value]) => withParam(next, key, value),
    withoutParam(url, pagingParam),
  );
  // Page N of the walk is the site's `first + N - 1` (rabota counts from 0, the rest from 1).
  const pageUrl = (n: number): string =>
    'cursor' in def ? base : withParam(base, pagingParam, String(def.page.first + n - 1));
  const now = new Date();
  // Per call, not per adapter: the adapter is shared by concurrent polls.
  let sent = 0;
  return paginate({
    firstUrl: pageUrl(1),
    host: def.host,
    parsePage: (html, page) => {
      const { listings, next, sent: raw } = def.parse(html, { url, page, now, sent });
      sent += raw ?? listings.length;
      // An empty token or `false` alike: no page follows.
      if (!next) return { listings, nextUrl: null };
      return {
        listings,
        nextUrl: typeof next === 'string' ? withParam(base, pagingParam, next) : pageUrl(page + 1),
      };
    },
    logger,
    useProxy: def.useProxy,
    pinPath: def.pinPath,
  });
}
