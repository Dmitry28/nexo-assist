import { parseNextData } from '../next-data';
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

/** Parse a realt search page's `__NEXT_DATA__`. Returns an empty page on any failure. */
export function extractPage(html: string): RealtPage {
  const data = parseNextData(html);
  if (!data) return { objects: [], pagination: null };

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  return {
    objects: (pageProps?.objects as RawRealtObject[] | undefined) ?? [],
    pagination: (pageProps?.pagination as RawPagination | undefined) ?? null,
  };
}

/**
 * Map a raw object to a normalized listing.
 * `linkPath` is the object-URL slug (e.g. `sale-plots`) derived from the search URL.
 */
export function mapObject(obj: RawRealtObject, linkPath: string): Listing {
  // NOTE: title is often empty on realt — fall back to town + street, then a generic label.
  const place = [str(obj.townName), str(obj.streetName)].filter(
    (s): s is string => s !== undefined,
  );
  const title = str(obj.title) ?? (place.length > 0 ? place.join(', ') : 'Объявление');

  return {
    externalId: String(obj.code),
    link: `https://realt.by/${linkPath}/object/${obj.code}/`,
    title,
    description: str(obj.headline) ?? str(obj.description),
    priceByn: toPrice(obj.priceRates?.[CURRENCY_BYN]),
    priceUsd: toPrice(obj.priceRates?.[CURRENCY_USD]),
    address: str(obj.address),
    listTime: obj.updatedAt,
    images: obj.images ?? [],
  };
}

function str(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toPrice(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? Math.round(value) : undefined;
}
