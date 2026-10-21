import { startCode } from '../auction-lot';
import type { LotFilter, Range } from '../auction-lot';
import { asNumber, asText } from '../scraping/next-data';
import { UnsupportedSearchError } from '../source-adapter';

/** Query keys that name the search. Anything else on a fallback would silently widen it. */
const USED = new Set([
  'make',
  'model',
  'year-from',
  'year-to',
  'type',
  'auction-type',
  'status',
  'odometer-from',
  'odometer-to',
  'engine-size-from',
  'engine-size-to',
  'start-code',
]);
/** Pins, pager and the site's own "this is a filter form" flag — they name no extra constraint. */
const NOISE = new Set(['search-type', 'order-by', 'page']);

const ANY = new Set(['', 'all']);

export type AuctionHouse = 'copart' | 'iaai';

/** What the pasted bid.cars link asked for, in the auctions' own terms. */
export interface AuctionFilters {
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  /** Copart `VEHT` code, when the type is one we map. IAAI has no working type POST. */
  vehicle?: { copart: string };
  houses: AuctionHouse[];
  /** What the auctions' search cannot filter — applied to the lots fetched (matchesLot). */
  lot: LotFilter;
}

const VEHICLE_TYPES: Record<string, { copart: string }> = {
  automobile: { copart: 'VEHTYPE_V' },
};

const HOUSES: Record<string, AuctionHouse[]> = {
  all: ['copart', 'iaai'],
  copart: ['copart'],
  iaai: ['iaai'],
};

/**
 * Filters the auctions can honour. Unknown keys or values throw — a closed bid.cars must not
 * become a wider Copart/IAAI search than the link.
 */
export function auctionFilters(url: string): AuctionFilters {
  const params = new URL(url).searchParams;
  const unknown = [...params.keys()].filter((key) => !USED.has(key) && !NOISE.has(key));
  if (unknown.length > 0) throw new UnsupportedSearchError(url, unknown);

  const type = named(params.get('type'));
  const vehicle = type === undefined ? undefined : VEHICLE_TYPES[type.toLowerCase()];
  if (type !== undefined && vehicle === undefined) {
    throw new UnsupportedSearchError(url, [`type=${type}`]);
  }

  const house = named(params.get('auction-type')) ?? 'All';
  const houses = HOUSES[house.toLowerCase()];
  if (houses === undefined) throw new UnsupportedSearchError(url, [`auction-type=${house}`]);

  const status = asText(params.get('status'));
  if (status !== undefined && status.toLowerCase() !== 'active') {
    throw new UnsupportedSearchError(url, [`status=${status}`]);
  }

  const start = named(params.get('start-code'));
  const code = start === undefined ? undefined : startCode(start);
  if (start !== undefined && code === undefined) {
    throw new UnsupportedSearchError(url, [`start-code=${start}`]);
  }

  return {
    make: named(params.get('make'))?.toUpperCase(),
    model: named(params.get('model'))?.toUpperCase(),
    yearFrom: bound(url, params, 'year-from'),
    yearTo: bound(url, params, 'year-to'),
    vehicle,
    houses,
    // NOTE: bid.cars lists US lots, so its odometer bounds are taken as miles — the unit both
    // auctions report — and engine size as litres (`engine-size-to=2`), as both write it.
    lot: {
      odometer: range(url, params, 'odometer'),
      engine: range(url, params, 'engine-size'),
      start: code,
    },
  };
}

const named = (raw: string | null): string | undefined => {
  const text = asText(raw);
  return text !== undefined && !ANY.has(text.toLowerCase()) ? text : undefined;
};

function range(url: string, params: URLSearchParams, key: string): Range | undefined {
  const from = bound(url, params, `${key}-from`);
  const to = bound(url, params, `${key}-to`);
  return from === undefined && to === undefined ? undefined : { from, to };
}

function bound(url: string, params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const value = asNumber(raw);
  if (value === undefined) throw new UnsupportedSearchError(url, [key]);
  return value;
}
