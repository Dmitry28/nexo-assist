import { detail, listingDetails } from '../listing-details';
import {
  asArray,
  asCoordinates,
  asPositiveNumber,
  asRecord,
  asText,
  parseNextData,
} from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
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
  images?: { gallery?: string[]; listings?: string[] };
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

interface RawPaginator {
  page: number;
  pages: number;
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
  const data = parseNextData(html);
  if (!data) throw new SourceUnavailableError('kufar-travel: __NEXT_DATA__ missing or unparseable');

  const listing = asRecord(asRecord(asRecord(data.props)?.initialState)?.listing);
  const all = asArray<RawRentalObject>(listing?.rentalObjects);
  if (!all) {
    throw new SourceUnavailableError('kufar-travel: rentalObjects missing — page layout changed?');
  }
  // No paginator means no next page; `pages` is 0 on a zero-result search (measured).
  const paginator = asRecord(listing?.bookingPaginator) as RawPaginator | undefined;
  const hasMore = paginator !== undefined && paginator.page < paginator.pages;
  return { objects: withoutPromotedHotels(all), hasMore };
}

/**
 * Drop the hotels travel splices into every page out of order: measured 2026-10-06, slots
 * 2/8/14/20/26 of a newest-first page held hotels listed weeks earlier. Outside the order they
 * break the window's premise, and a rotating promo pool would deliver an old hotel as "new". A
 * hotel listed inside the page's own span is in order, so it stays — a new hotel still arrives.
 * A page with no dated unit has no span to judge by, so it is kept whole.
 */
function withoutPromotedHotels(objects: RawRentalObject[]): RawRentalObject[] {
  const units = objects
    .filter((o) => o.isHotel !== true)
    .map((o) => Date.parse(o.listTime))
    .filter((t) => !Number.isNaN(t));
  if (units.length === 0) return objects;
  const oldest = Math.min(...units);
  // An undated hotel compares as NaN and is dropped: it cannot be placed in the order either.
  return objects.filter((o) => o.isHotel !== true || Date.parse(o.listTime) >= oldest);
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
    priceByn: toPrice(raw.price),
    priceUsd: toPrice(raw.priceConversions?.usd),
    address: asText(raw.address),
    listTime: raw.listTime,
    // `gallery` is the full-size set; `listings` the thumbnails — the fallback, not the choice.
    images: asArray<string>(raw.images?.gallery) ?? asArray<string>(raw.images?.listings) ?? [],
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

// The price is per night, in 1/100 of the unit; a 0 is "not set", not a free stay.
function toPrice(raw: unknown): number | undefined {
  const value = Math.round((asPositiveNumber(raw) ?? 0) / 100);
  return value > 0 ? value : undefined;
}
