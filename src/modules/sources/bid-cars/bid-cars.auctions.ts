import { Logger } from '@nestjs/common';

import { withParam } from '@/common/url';

import { matchesLot, missingFact } from '../auction-lot';
import {
  HOST as COPART_HOST,
  load as copartLoad,
  parsePage as copartPage,
} from '../copart/copart.parser';
import { listingsFrom as iaaiListings, loadSearch as iaaiLoad } from '../iaai/iaai.parser';
import { MAX_LISTINGS, SourceUnavailableError, UnsupportedSearchError } from '../source-adapter';
import type { Listing } from '../source-adapter';

import type { AuctionFilters } from './bid-cars.filters';
import { auctionFilters } from './bid-cars.filters';

const logger = new Logger('bid-cars:auctions');

const COPART_PAGE_SIZE = 100;
const FACT_CHECK_MIN_LOTS = 10;
const IAAI_PAGE_SIZE = 100;

/** Copart + IAAI lots for the pasted bid.cars filters, ids in bid.cars's `1-` / `0-` form. */
export async function fromAuctions(url: string): Promise<Listing[]> {
  const filters = auctionFilters(url);
  const keyword = iaaiKeyword(filters);
  // IAAI Keyword with no make/model returns 0 lots (measured 2026-10-19). Skip it when Copart
  // can still run; refuse when IAAI was the only house.
  const houses = filters.houses.filter((house) => house !== 'iaai' || keyword !== '');
  if (houses.length === 0) throw new UnsupportedSearchError(url, ['make']);
  const settled = await Promise.allSettled(
    houses.map(async (house) => {
      const lots =
        house === 'copart'
          ? await copartLots(filters, MAX_LISTINGS)
          : await iaaiLots(filters, keyword);
      // Loud, not an empty result: a fact the filter needs that no lot of a house carries is the
      // parser missing the field, and failing every lot on it would silence that house for good.
      // Only past a floor — a handful of lots may all lack a start badge.
      const missing =
        lots.length >= FACT_CHECK_MIN_LOTS ? missingFact(lots, filters.lot) : undefined;
      if (missing !== undefined) {
        throw new SourceUnavailableError(`${house}: no lot carries «${missing}» — layout changed?`);
      }
      return lots;
    }),
  );
  // One house not answering is not the search down: the other's lots still go out (Copart refuses
  // every datacenter IP we have, measured 2026-10-20). Our own bug or a refused filter is not
  // «not answering» — rethrown. Every house down — the search did not answer.
  const byHouse = new Map<string, Listing[]>();
  const down: SourceUnavailableError[] = [];
  for (const [i, result] of settled.entries()) {
    const house = houses[i] as string;
    if (result.status === 'fulfilled') {
      byHouse.set(house, result.value);
      continue;
    }
    const err: unknown = result.reason;
    if (!(err instanceof SourceUnavailableError) || err instanceof UnsupportedSearchError)
      throw err;
    down.push(err);
    logger.warn({ err }, `bid.cars fallback: ${house} did not answer — the other house only`);
  }
  if (byHouse.size === 0) throw down[0];
  // TODO [M]: a lot of the house that was down reads as new once it answers again (no «partial»
  // flag on a single-page source); bounded by the digest cap.
  // IAAI first: a full Copart window must not drop the other house.
  const listings = [...(byHouse.get('iaai') ?? []), ...(byHouse.get('copart') ?? [])];
  const byId = new Map<string, Listing>();
  for (const listing of listings) {
    if (!byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  // TODO [M]: the lot filter sees only the fetched window — matching lots past its edge are lost.
  // Copart's own odometer / condition filters (unmeasured) would move it before the window.
  const unique = [...byId.values()];
  const kept = unique.filter((listing) => matchesLot(listing, filters.lot));
  // The overflow is judged on what was fetched: once the filter narrows it under the window,
  // the extra-listing marker (`capped`, below) can no longer carry it.
  if (unique.length > MAX_LISTINGS && kept.length <= MAX_LISTINGS) {
    logger.warn(`Auction window overflowed before the lot filter: ${url}`);
  }
  // One extra listing tells paginate the window overflowed (`capped`).
  return kept.slice(0, kept.length > MAX_LISTINGS ? MAX_LISTINGS + 1 : MAX_LISTINGS);
}

async function copartLots(filters: AuctionFilters, limit: number): Promise<Listing[]> {
  const listings: Listing[] = [];
  const want = limit + 1;
  const pages = Math.ceil(want / COPART_PAGE_SIZE);
  const base = copartUrl(filters);
  for (let page = 0; page < pages && listings.length < want; page++) {
    const body = await copartLoad(withParam(base, 'page', String(page)));
    const parsed = copartPage(body, {
      url: base,
      page: page + 1,
      now: new Date(),
      sent: listings.length,
    });
    listings.push(...parsed.listings);
    if (!parsed.next) break;
  }
  return listings.slice(0, want).map((listing) => asBidCarsLot(listing, '1', listing.externalId));
}

async function iaaiLots(filters: AuctionFilters, keyword: string): Promise<Listing[]> {
  const listings = iaaiListings(await iaaiLoad(iaaiBody(keyword)));
  return listings.flatMap((listing) => {
    const stock = listing.details.find((line) => line.label === 'Stock')?.value;
    const year = yearOf(listing.title);
    const inYear =
      (filters.yearFrom === undefined || (year !== undefined && year >= filters.yearFrom)) &&
      (filters.yearTo === undefined || (year !== undefined && year <= filters.yearTo));
    return stock === undefined || !inYear ? [] : [asBidCarsLot(listing, '0', stock)];
  });
}

function copartUrl(filters: AuctionFilters): string {
  const filter: Record<string, string[]> = {};
  if (filters.make !== undefined) filter.MAKE = [`lot_make_desc:"${filters.make}"`];
  if (filters.model !== undefined) filter.MODEL = [`lot_model_desc:"${filters.model}"`];
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    filter.YEAR = [`lot_year:[${filters.yearFrom ?? 1900} TO ${filters.yearTo ?? 2100}]`];
  }
  if (filters.vehicle !== undefined) {
    filter.VEHT = [`vehicle_type_code:${filters.vehicle.copart}`];
  }
  const criteria = {
    query: ['*'],
    filter,
    watchListOnly: false,
    freeFormSearch: filters.make === undefined && filters.model === undefined,
  };
  return `https://www.${COPART_HOST}/lotSearchResults?searchCriteria=${encodeURIComponent(JSON.stringify(criteria))}`;
}

const iaaiKeyword = (filters: AuctionFilters): string =>
  [filters.make, filters.model]
    .filter((part) => part !== undefined)
    .join(' ')
    .toLowerCase();

function iaaiBody(keyword: string): Record<string, unknown> {
  // Measured 2026-10-19: Facets + empty FullSearch returns 0 lots. Keyword is the site's POST.
  return {
    Searches: [{ FullSearch: keyword }],
    PageSize: IAAI_PAGE_SIZE,
    CurrentPage: 1,
    ReturnFacets: false,
    Sort: [{ SortField: 'AuctionDateTime', IsDescending: true, IsGeoSort: false }],
  };
}

const yearOf = (title: string): number | undefined => {
  const year = /^(\d{4})\s/.exec(title)?.[1];
  return year === undefined ? undefined : Number(year);
};

const asBidCarsLot = (listing: Listing, prefix: '0' | '1', id: string): Listing => ({
  ...listing,
  externalId: `${prefix}-${id}`,
});
