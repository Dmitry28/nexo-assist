import { detail, listingDetails } from '../listing-details';
import {
  asCoordinates,
  asNumber,
  asPositiveNumber,
  asPrice,
  asRecord,
  asText,
  asTexts,
  requireArray,
  requireNextData,
  withIds,
  withoutStalePromos,
} from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';

/** travel.kufar.by — kufar's short-term (per-night) rentals: its own app and payload. */
export const HOST = 'travel.kufar.by';

/**
 * Raw rental object from travel.kufar.by's `__NEXT_DATA__` — only the fields we read. Cast, not
 * validated, like the other parsers: every field is read defensively in mapRentalObject.
 */
interface RawRentalObject {
  adId: number;
  subject?: string;
  /** The full text; `shortDescription` is cut at ~45 characters (measured), too short to read. */
  body?: string;
  /** Per night, in 1/100 BYN (7500 → 75 BYN). */
  price?: number;
  /** The same price converted, also in 1/100 of each currency. */
  priceConversions?: { usd?: number };
  address?: string;
  listTime: string;
  images?: { gallery?: unknown; listings?: unknown };
  /** `[longitude, latitude]` — the same order as kufar's sale ads. */
  coordinates?: unknown;
  housingType?: { ru?: string };
  /**
   * A hotel lists itself, not a unit: its `size`/`rooms`/`personsMax` read 1/1/2 on every hotel
   * measured (5 of 5) — defaults, not facts — so a card shows none of them.
   */
  isHotel?: boolean;
  rooms?: number;
  /** Area in m² (cross-checked against the same ad on re.kufar.by). NOT `area` — a district code. */
  size?: number;
  floor?: number;
  personsMax?: number;
  formattedRating?: string;
  ratingScoresCount?: number;
}

/** One page of a travel search: its rental objects and whether a later page exists. */
export interface KufarTravelPage {
  objects: RawRentalObject[];
  hasMore: boolean;
}

/**
 * Parse a travel search page's `__NEXT_DATA__`.
 * Throws when `rentalObjects` is missing: a zero-result search still carries `[]` (measured), so
 * its absence is a layout change or a bot-wall, which must not read as an empty search.
 */
export function extractPage(html: string): KufarTravelPage {
  const data = requireNextData(html, 'kufar-travel');
  const listing = asRecord(asRecord(asRecord(data.props)?.initialState)?.listing);
  const all = withIds(
    requireArray<RawRentalObject>(listing?.rentalObjects, 'kufar-travel', 'rentalObjects'),
    (o) => o.adId,
    'kufar-travel',
  );
  // No paginator means no next page; `pages` is 0 on a zero-result search (measured).
  const paginator = asRecord(listing?.bookingPaginator);
  const page = asNumber(paginator?.page);
  const pages = asNumber(paginator?.pages);
  const hasMore = page !== undefined && pages !== undefined && page < pages;
  // Hotels sit in fixed slots (2/8/14/20/26, measured 2026-10-06) listed weeks earlier.
  const objects = withoutStalePromos(
    all,
    (o) => o.isHotel === true,
    (o) => o.listTime,
  );
  return { objects, hasMore };
}

/** Map a raw rental object to a normalized listing. */
export function mapRentalObject(raw: RawRentalObject): Listing {
  const rating = asText(raw.formattedRating);
  const reviews = asPositiveNumber(raw.ratingScoresCount);
  const unit = raw.isHotel === true ? undefined : raw;
  return {
    externalId: String(raw.adId),
    // `selfUrl` is empty or carries the search's dates; the id link is stable (measured: 200).
    link: `https://${HOST}/hotel/${raw.adId}`,
    title: asText(raw.subject) ?? UNTITLED_LISTING,
    description: preview(raw.body),
    priceByn: asPrice(raw.price, { minorUnits: true }),
    priceUsd: asPrice(raw.priceConversions?.usd, { minorUnits: true }),
    address: asText(raw.address),
    listTime: raw.listTime,
    // `gallery` is the full-size set; `listings` the thumbnails — the fallback, not the choice.
    images: asTexts(raw.images?.gallery ?? raw.images?.listings),
    coordinates: asCoordinates(raw.coordinates),
    details: listingDetails(
      detail('Тип', asText(raw.housingType?.ru)),
      detail('Комнат', asPositiveNumber(unit?.rooms)),
      detail('Площадь', asPositiveNumber(unit?.size), 'м²'),
      detail('Этаж', asPositiveNumber(unit?.floor)),
      detail('Гостей', asPositiveNumber(unit?.personsMax)),
      // An object without reviews still carries a rating field; it is noise, not a score.
      detail(
        'Рейтинг',
        rating === undefined || reviews === undefined ? undefined : `${rating} (${reviews} отз.)`,
      ),
    ),
  };
}

// The length kufar's sale ads arrive cut to (`body_short`), so cards read alike across sources.
const PREVIEW_CHARS = 150;

function preview(raw: unknown): string | undefined {
  const text = asText(raw);
  return text !== undefined && text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…`
    : text;
}
