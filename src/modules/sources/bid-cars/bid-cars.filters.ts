import { asNumber, asText } from '../scraping/next-data';
import { UnsupportedSearchError } from '../source-adapter';

/** Query keys that name the search. Anything else on a fallback would silently widen it. */
const USED = new Set(['make', 'model', 'year-from', 'year-to', 'type', 'auction-type', 'status']);
/** Pins, pager and the site's own "this is a filter form" flag — they name no extra constraint. */
const NOISE = new Set(['search-type', 'order-by', 'page']);

const ANY = new Set(['', 'all']);

type AuctionHouse = 'copart' | 'iaai';

/** What the pasted bid.cars link asked for, in the auctions' own terms. */
export interface AuctionFilters {
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  /** Copart `VEHT` code, when the type is one we map. IAAI has no working type POST. */
  vehicle?: { copart: string };
  houses: AuctionHouse[];
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

  return {
    make: named(params.get('make'))?.toUpperCase(),
    model: named(params.get('model'))?.toUpperCase(),
    yearFrom: yearBound(url, params, 'year-from'),
    yearTo: yearBound(url, params, 'year-to'),
    vehicle,
    houses,
  };
}

const named = (raw: string | null): string | undefined => {
  const text = asText(raw);
  return text !== undefined && !ANY.has(text.toLowerCase()) ? text : undefined;
};

function yearBound(url: string, params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const year = asNumber(raw);
  if (year === undefined) throw new UnsupportedSearchError(url, [key]);
  return year;
}
