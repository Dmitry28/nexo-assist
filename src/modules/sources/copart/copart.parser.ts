import { detail, listingDetails } from '../listing-details';
import { fetchJson } from '../scraping/http';
import {
  asCoordinates,
  asNumber,
  asRecord,
  asText,
  parseJson,
  requireArray,
} from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { PageContext, SearchPage } from '../source-definition';

/** copart.com — US salvage auctions; the site's own search JSON, no Cloudflare. */
export const HOST = 'copart.com';

/** The lot board the site's search form lands on. */
export const SEARCH_PATH = /^\/lotSearchResults$/;

const SEARCH_API = 'https://www.copart.com/public/lots/search-results';
const PAGE_SIZE = 100;
/** Flip with the source's `useProxy` — POST bypasses `get`, so the flag must live here too. */
export const USE_PROXY = false;

/** `$3,475` — auction figures are USD; 0 is «no bid yet», not a price. */
export function usdText(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** One page of the site's search JSON for the pasted (or bid.cars-derived) URL. */
export function load(url: string): Promise<string> {
  return fetchJson({
    url: SEARCH_API,
    host: HOST,
    body: JSON.stringify(searchBody(url)),
    useProxy: USE_PROXY,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://www.copart.com',
      Referer: 'https://www.copart.com/',
    },
  });
}

/** The POST the copart.com frontend sends — make/model when the link names them, else `query`. */
export function searchBody(url: string): Record<string, unknown> {
  const params = new URL(url).searchParams;
  const page = Math.max(0, asNumber(params.get('page')) ?? 0);
  const make = asText(params.get('make'))?.toUpperCase();
  const model = asText(params.get('model'))?.toUpperCase();
  const query = asText(params.get('query')) ?? '*';
  const filter: Record<string, string[]> = {};
  if (make !== undefined) filter.MAKE = [`lot_make_desc:"${make}"`];
  if (model !== undefined) filter.MODEL = [`lot_model_desc:"${model}"`];
  return {
    query: [query],
    filter,
    sort: ['auction_date_type desc', 'auction_date_utc desc'],
    page,
    size: PAGE_SIZE,
    start: page * PAGE_SIZE,
    watchListOnly: false,
    freeFormSearch: make === undefined && model === undefined,
  };
}

/**
 * A success payload's lots. Anything else — HTML, a challenge, a renamed envelope — is the
 * source not answering, never an empty search.
 */
export function listingsFrom(body: string): Listing[] {
  return lotsOf(body).flatMap((lot) => {
    const listing = toListing(lot);
    return listing === undefined ? [] : [listing];
  });
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

function toListing(lot: Record<string, unknown>): Listing | undefined {
  const id =
    asText(lot.lotNumberStr) ?? (asNumber(lot.ln) !== undefined ? String(lot.ln) : undefined);
  if (id === undefined) return undefined;
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
  return {
    externalId: id,
    link: `https://${HOST}/lot/${id}${slug === undefined ? '' : `/${slug}`}`,
    title: asText(lot.ld) ?? UNTITLED_LISTING,
    priceText: priceLines.length > 0 ? priceLines.join(' · ') : undefined,
    address: asText(lot.yn),
    listTime: auctionMs === undefined ? '' : new Date(auctionMs).toISOString(),
    images: thumb?.startsWith('https://') === true ? [thumb] : [],
    coordinates: lat === undefined || lon === undefined ? undefined : asCoordinates([lon, lat]),
    details: listingDetails(
      detail('VIN', maskedVin(asText(lot.fv))),
      detail('Аукцион', 'COPART'),
      detail('Пробег', miles !== undefined && miles > 0 ? `${Math.round(miles)} mi` : undefined),
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
