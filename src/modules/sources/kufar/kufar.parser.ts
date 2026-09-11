import { detail, listingDetails } from '../listing-details';
import {
  asArray,
  asNumber,
  asPositiveNumber,
  asRecord,
  asText,
  parseNextData,
} from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Coordinates, Listing } from '../source-adapter';

/**
 * Raw ad shape from Kufar's `__NEXT_DATA__` JSON — only the fields we read.
 * NOTE: every field here is a promise about untyped JSON, not a guarantee — the blob is cast,
 * not validated (extractPage only checks that `ads` is an array). So `subject`, which the
 * digest dereferences, is read defensively in mapAd.
 */
interface RawKufarAd {
  ad_id: number;
  ad_link?: string;
  subject?: string;
  body_short?: string;
  price_byn?: string;
  price_usd?: string;
  list_time: string;
  images?: Array<{ path: string }>;
  ad_parameters?: RawParam[];
  account_parameters?: RawParam[];
}

/**
 * One entry of an ad's parameter blocks. `v` is the raw value — for a dictionary field an
 * internal code ("house_type_1") — and `vl` the label kufar itself shows, which is the one a
 * card can print.
 */
interface RawParam {
  p: string;
  v: unknown;
  vl?: unknown;
}

// The gallery variant, not the list thumbnail the prototype used: measured on a live ad, the
// same image is 920×690 (82 KB) here against 667×500 (47 KB) there — and a card shows it full
// width. Both paths answer 302 to a shard host (rms → rms8); Telegram follows that itself,
// see send-card.ts.
const IMAGE_CDN_BASE = 'https://rms.kufar.by/v1/gallery';

interface RawPagination {
  label: string;
  token: string | null;
}

/** One page of a Kufar search: ads + the cursor token for the next page (null = last). */
export interface KufarPage {
  ads: RawKufarAd[];
  nextCursor: string | null;
}

/**
 * Parse a Kufar search page's `__NEXT_DATA__`.
 * Throws when the listing state is missing — a bot-wall or layout change must not
 * read as an empty search (verified live: a zero-result search still has `ads: []`).
 */
export function extractPage(html: string): KufarPage {
  const data = parseNextData(html);
  if (!data) throw new Error('kufar: __NEXT_DATA__ missing or unparseable');

  const props = asRecord(data.props);
  const pageProps = asRecord(props?.pageProps);
  // NOTE: Kufar puts Redux state under props.pageProps.initialState or props.initialState.
  const initialState = asRecord(pageProps?.initialState ?? props?.initialState);
  const listing = asRecord(initialState?.listing);
  const ads = asArray<RawKufarAd>(listing?.ads);
  if (!ads) throw new Error('kufar: listing.ads missing — page layout changed?');
  // No pagination block, or one of another shape, simply means no next page — unlike `ads`,
  // whose absence is the signal that the page is not a search result at all.
  const pagination = asArray<RawPagination>(listing?.pagination) ?? [];
  const nextCursor = pagination.find((p) => p.label === 'next')?.token ?? null;
  return { ads, nextCursor };
}

/** Map a raw ad to a normalized listing. */
export function mapAd(ad: RawKufarAd): Listing {
  return {
    externalId: String(ad.ad_id),
    link: ad.ad_link ?? `https://re.kufar.by/vi/${ad.ad_id}`,
    // A titleless ad must degrade to a label, not take the whole digest down with it: the
    // formatter reads `.length` off this (realt.parser.ts falls back the same way).
    title: asText(ad.subject) ?? UNTITLED_LISTING,
    description: asText(ad.body_short),
    priceByn: toPrice(ad.price_byn),
    priceUsd: toPrice(ad.price_usd),
    address: asText(param(ad.account_parameters, 'address')),
    listTime: ad.list_time,
    images: (ad.images ?? []).map((image) => `${IMAGE_CDN_BASE}/${image.path}`),
    coordinates: toCoordinates(param(ad.ad_parameters, 'coordinates')),
    seller: asText(param(ad.account_parameters, 'name')),
    // Order is the card's reading order — what identifies the object first, extras last.
    details: listingDetails(
      detail('Тип', propertyType(ad)),
      detail('Площадь', asPositiveNumber(param(ad.ad_parameters, 'size')), 'м²'),
      detail('Участок', asPositiveNumber(param(ad.ad_parameters, 'size_area')), 'сот.'),
      detail('Комнат', asPositiveNumber(param(ad.ad_parameters, 'rooms'))),
      detail('Год постройки', asPositiveNumber(param(ad.ad_parameters, 'year_built'))),
      detail('Удобства', amenities(ad)),
    ),
  };
}

// NOTE: Kufar stores prices as integers in 1/100 of the currency unit (1385000 → 13850 BYN).
// The positivity check comes AFTER the conversion: a raw value under 50 rounds to 0, and a
// `priceByn` of 0 is not a price — the digest would print "0 BYN" rather than "цена не указана".
function toPrice(raw: string | undefined): number | undefined {
  const value = Math.round(parseInt(raw ?? '', 10) / 100);
  return value > 0 ? value : undefined;
}

/** One parameter by key, taking its raw value (`v`) or its display label (`vl`). */
function param(params: RawParam[] | undefined, key: string, field: 'v' | 'vl' = 'v'): unknown {
  return asArray<RawParam>(params)?.find((p) => p.p === key)?.[field];
}

// The object type lives under a different key per category. Verified live on two searches: a
// house ad carries only `house_type_for_sell`, a plot ad none of them. An ad setting two is
// unproven, so the order matters — the most specific key wins.
function propertyType(ad: RawKufarAd): string | undefined {
  return (
    asText(param(ad.ad_parameters, 'house_type_for_sell', 'vl')) ??
    asText(param(ad.ad_parameters, 'land_type', 'vl')) ??
    asText(param(ad.ad_parameters, 'garage_type', 'vl')) ??
    // A parking space has no garage_type — this is what names it ("Машиноместо").
    asText(param(ad.ad_parameters, 'garage_parking_type', 'vl'))
  );
}

// Amenity parameters worth a line in a card. Their labels come as a single string or as a list
// (a house has several), so both shapes are flattened into one comma-separated line.
const AMENITY_KEYS = [
  're_heating',
  're_water',
  're_property_rights',
  're_outbuildings',
  'garage_improvements',
];

function amenities(ad: RawKufarAd): string | undefined {
  const labels = AMENITY_KEYS.flatMap((key) => {
    const value = param(ad.ad_parameters, key, 'vl');
    return (asArray<unknown>(value) ?? [value]).map(asText).filter((l) => l !== undefined);
  });
  return labels.length > 0 ? labels.join(', ') : undefined;
}

/**
 * Kufar's `coordinates` parameter, stored as `[longitude, latitude]` — longitude FIRST, the
 * reverse of the usual order (verified live: a Grodno ad reads `[23.85, 53.68]`). The order is
 * pinned by a spec, not by this check: for Belarus both figures are in range either way, so a
 * swap would pass here and only show up as a pin in the wrong country.
 *
 * What the check does catch: malformed values, and `[0, 0]` — a zeroed pair is not a location
 * off the African coast, it is a field nobody filled.
 */
function toCoordinates(value: unknown): Coordinates | undefined {
  const pair = asArray<unknown>(value);
  const lon = asNumber(pair?.[0]);
  const lat = asNumber(pair?.[1]);
  if (lon === undefined || lat === undefined) return undefined;
  if (lat === 0 && lon === 0) return undefined;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}
