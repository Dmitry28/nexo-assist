import { asArray, asRecord, asText, parseNextData } from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';

/** Raw object shape from realt.by's `__NEXT_DATA__` JSON — only the fields we read. */
interface RawRealtObject {
  code: number;
  title?: string | null;
  headline?: string | null;
  description?: string | null;
  updatedAt: string;
  /** Currency conversions keyed by ISO 4217 numeric code. */
  priceRates?: Record<string, number>;
  address?: string | null;
  townName?: string | null;
  streetName?: string | null;
  /** Pre-built CDN URLs. */
  images?: string[];
}

// realt.by priceRates currency codes (ISO 4217 numeric).
const CURRENCY_USD = '840';
const CURRENCY_BYN = '933';

interface RawPagination {
  pageSize: number;
  totalCount: number;
}

/** One page of a realt search: objects + pagination block (null = unknown). */
export interface RealtPage {
  objects: RawRealtObject[];
  pagination: RawPagination | null;
}

/**
 * Parse a realt search page's `__NEXT_DATA__`.
 * Throws when the blob or `pageProps` is missing — a bot-wall or layout change
 * must not read as an empty search. A present `pageProps` without an `objects`
 * array is NOT an error: realt renders some zero-result pages so (observed live).
 */
export function extractPage(html: string): RealtPage {
  const data = parseNextData(html);
  if (!data) throw new Error('realt: __NEXT_DATA__ missing or unparseable');

  const props = asRecord(data.props);
  // NOTE: asRecord rejects a non-object `pageProps` (an array, a string) where the previous cast
  // let it through to `objects: []`. Deliberate, and unreachable with a real Next.js payload: a
  // shape we don't recognise is a layout change, which must not read as an empty search.
  const pageProps = asRecord(props?.pageProps);
  if (!pageProps) throw new Error('realt: pageProps missing — page layout changed?');
  return {
    // Array-checked: an `objects` of another shape would otherwise reach `.map` in the adapter
    // and throw "map is not a function" — a crash that names nothing useful.
    objects: asArray<RawRealtObject>(pageProps.objects) ?? [],
    // Left a plain cast, unlike `objects`: nothing dereferences this block, the adapter only
    // reads two numbers off it, and a wrong shape yields NaN → "no next page". Nothing to guard.
    pagination: (pageProps.pagination as RawPagination | undefined) ?? null,
  };
}

/**
 * Map a raw object to a normalized listing.
 * `linkPath` is the object-URL slug (e.g. `sale-plots`) derived from the search URL.
 */
export function mapObject(obj: RawRealtObject, linkPath: string): Listing {
  // NOTE: title is often empty on realt — fall back to town + street, then a generic label.
  const place = [asText(obj.townName), asText(obj.streetName)].filter((s) => s !== undefined);
  const title = asText(obj.title) ?? (place.length > 0 ? place.join(', ') : UNTITLED_LISTING);

  return {
    externalId: String(obj.code),
    link: `https://realt.by/${linkPath}/object/${obj.code}/`,
    title,
    description: asText(obj.headline) ?? asText(obj.description),
    priceByn: toPrice(obj.priceRates?.[CURRENCY_BYN]),
    priceUsd: toPrice(obj.priceRates?.[CURRENCY_USD]),
    address: asText(obj.address),
    listTime: obj.updatedAt,
    images: obj.images ?? [],
  };
}

function toPrice(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? Math.round(value) : undefined;
}
