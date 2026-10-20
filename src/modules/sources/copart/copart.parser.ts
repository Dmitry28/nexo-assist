import { LOT_LABELS, startText } from '../auction-lot';
import { detail, listingDetails } from '../listing-details';
import { fetchProtected } from '../scraping/ladder';
import type { Protection } from '../scraping/ladder';
import {
  asCoordinates,
  asNumber,
  asRecord,
  asText,
  parseJson,
  requireArray,
  withIds,
} from '../scraping/next-data';
import { pageCredits, poolOf } from '../scraping/providers';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing, PaidPoll } from '../source-adapter';
import type { PageContext, SearchPage } from '../source-definition';

/** copart.com — US salvage auctions; the site's own search JSON, behind Imperva. */
export const HOST = 'copart.com';

/** The lot board the site's search form lands on. */
export const SEARCH_PATH = /^\/lotSearchResults$/;

const SEARCH_API = 'https://www.copart.com/public/lots/search-results';
const PAGE_SIZE = 100;
/** `$3,475` — auction figures are USD; 0 is «no bid yet», not a price. */
export function usdText(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * One page of the site's search JSON for the pasted URL, up the fetch ladder as a POST: Imperva
 * answers every IP we have with its page (Hetzner and the Oracle proxy, 2026-10-20), and the paid
 * rungs carry the POST (ScrapingAnt, ScraperAPI without a browser, 1–3 s — measured the same day).
 * The free rungs go first: from elsewhere the site may still answer them.
 */
export function load(url: string): Promise<string> {
  return fetchProtected({
    url: SEARCH_API,
    host: HOST,
    protection: PROTECTION,
    post: {
      body: JSON.stringify(searchBody(url)),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://www.copart.com',
        Referer: 'https://www.copart.com/',
      },
    },
  });
}

/**
 * The search answer rather than Imperva's page — by its envelope, never by its lots. Any other
 * envelope climbs too (a refused criteria would cost every paid rung once) — none seen so far.
 */
export const isSearchJson = (body: string): boolean =>
  asNumber(asRecord(parseJson(body))?.returnCode) === 1;

const PROTECTION: Protection = { usable: isSearchJson, freeProxyCountry: 'us' };

/**
 * What a walk of `lots` costs at worst — every page paid (the free rungs mostly fail from our
 * IPs), plus one page: lots repeat across pages (measured 2026-10-20: 6 pages for 500).
 */
export const pollCredits = (lots: number): PaidPoll => ({
  credits: (Math.ceil(lots / PAGE_SIZE) + 1) * pageCredits(PROTECTION),
  pool: poolOf(PROTECTION),
});

/**
 * The POST the copart.com frontend sends. A filtered link carries `searchCriteria`; a simple
 * `query` / `make` / `model` link does not. Page and sort are ours (the walk, latest auction).
 */
export function searchBody(url: string): Record<string, unknown> {
  const params = new URL(url).searchParams;
  const page = Math.max(0, asNumber(params.get('page')) ?? 0);
  const paging = {
    page,
    size: PAGE_SIZE,
    start: page * PAGE_SIZE,
    sort: ['auction_date_type desc', 'auction_date_utc desc'],
  };
  const criteria = criteriaOf(params.get('searchCriteria'));
  if (criteria !== undefined) return { ...criteria, ...paging };
  const make = asText(params.get('make'))?.toUpperCase();
  const model = asText(params.get('model'))?.toUpperCase();
  const query = asText(params.get('query')) ?? '*';
  const filter: Record<string, string[]> = {};
  if (make !== undefined) filter.MAKE = [`lot_make_desc:"${make}"`];
  if (model !== undefined) filter.MODEL = [`lot_model_desc:"${model}"`];
  return {
    query: [query],
    filter,
    watchListOnly: false,
    freeFormSearch: make === undefined && model === undefined,
    ...paging,
  };
}

function criteriaOf(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const parsed = asRecord(parseJson(raw));
  if (parsed === undefined) {
    throw new SourceUnavailableError('copart: searchCriteria is not the site JSON');
  }
  return parsed;
}

/**
 * A success payload's lots. Anything else — HTML, a challenge, a renamed envelope — is the
 * source not answering, never an empty search.
 */
export function listingsFrom(body: string): Listing[] {
  return withIds(lotsOf(body), (lot) => asText(lot.lotNumberStr) ?? asNumber(lot.ln), 'copart').map(
    toListing,
  );
}

export function parsePage(body: string, ctx: PageContext): SearchPage<boolean> {
  const listings = listingsFrom(body);
  const results = asRecord(asRecord(asRecord(parseJson(body))?.data)?.results);
  const total = asNumber(results?.totalElements);
  const seen = ctx.sent + listings.length;
  return {
    listings,
    next: listings.length > 0 && (total === undefined || seen < total),
  };
}

function lotsOf(body: string): Record<string, unknown>[] {
  const root = asRecord(parseJson(body));
  if (asNumber(root?.returnCode) !== 1) {
    throw new SourceUnavailableError('copart: search JSON missing — page layout changed?');
  }
  const results = asRecord(asRecord(root?.data)?.results);
  return requireArray<unknown>(results?.content, 'copart', 'results.content')
    .map(asRecord)
    .filter((lot) => lot !== undefined);
}

function toListing(lot: Record<string, unknown>): Listing {
  const id = asText(lot.lotNumberStr) ?? String(asNumber(lot.ln));
  const slug = asText(lot.ldu);
  const bids = asRecord(lot.dynamicLotDetails);
  const current = usdText(asNumber(bids?.currentBid));
  const buyNow = usdText(asNumber(bids?.buyTodayBid));
  const miles = asNumber(lot.orr);
  const auctionMs = asNumber(lot.ad);
  const lat = asNumber(lot.lat);
  const lon = asNumber(lot.long);
  const thumb = asText(lot.tims);
  const priceLines = [
    current === undefined ? undefined : `Текущая ставка: ${current}`,
    buyNow === undefined ? undefined : `Купить сейчас: ${buyNow}`,
  ].filter((line) => line !== undefined);
  const when = auctionMs === undefined ? undefined : new Date(auctionMs).toISOString().slice(0, 10);
  return {
    externalId: id,
    link: `https://${HOST}/lot/${id}${slug === undefined ? '' : `/${slug}`}`,
    title: asText(lot.ld) ?? UNTITLED_LISTING,
    priceText: priceLines.length > 0 ? priceLines.join(' · ') : undefined,
    address: asText(lot.yn),
    listTime: '',
    images: thumb?.startsWith('https://') === true ? [thumb] : [],
    coordinates: lat === undefined || lon === undefined ? undefined : asCoordinates([lon, lat]),
    details: listingDetails(
      detail('VIN', maskedVin(asText(lot.fv))),
      detail('Аукцион', when === undefined ? 'COPART' : `COPART, ${when}`),
      detail(
        LOT_LABELS.odometer,
        miles !== undefined && miles > 0 ? `${Math.round(miles)} mi` : undefined,
      ),
      detail(LOT_LABELS.engine, asText(lot.egn)),
      // `egn` «2.0L 4»; `lcd` the lot's condition — «RUNS AND DRIVES», «ENGINE START PROGRAM»,
      // «ENHANCED VEHICLES» (not a start code), or none (measured 2026-10-20, 100 Atlas lots).
      detail(LOT_LABELS.start, startText(asText(lot.lcd))),
      detail('Повреждение', asText(lot.dd)),
      detail('Документ', asText(lot.tgd) ?? asText(lot.td)),
      detail('Ключи', keys(asText(lot.hk))),
    ),
  };
}

const maskedVin = (vin: string | undefined): string | undefined =>
  vin !== undefined && !vin.includes('*') ? vin : undefined;

const keys = (flag: string | undefined): string | undefined =>
  flag === 'YES' ? 'есть' : flag === 'NO' ? 'нет' : undefined;
