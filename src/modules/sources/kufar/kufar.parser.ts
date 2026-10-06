import { matchesHost } from '@/common/url';

import { detail, listingDetails } from '../listing-details';
import {
  asArray,
  asCoordinates,
  asPositiveNumber,
  asPrice,
  asRecord,
  asText,
  asTexts,
  requireArray,
  requireNextData,
  withIds,
} from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';

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
  images?: unknown;
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

/** The source's host — every search and every listing link must be on it (or a subdomain). */
export const HOST = 'kufar.by';

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
  const data = requireNextData(html, 'kufar');
  const props = asRecord(data.props);
  const pageProps = asRecord(props?.pageProps);
  // NOTE: Kufar puts Redux state under props.pageProps.initialState or props.initialState.
  const initialState = asRecord(pageProps?.initialState ?? props?.initialState);
  const listing = asRecord(initialState?.listing);
  const ads = withIds(
    requireArray<RawKufarAd>(listing?.ads, 'kufar', 'listing.ads'),
    (ad) => ad.ad_id,
    'kufar',
  );
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
    link: link(ad),
    // A titleless ad must degrade to a label, not take the whole digest down with it: the
    // formatter reads `.length` off this (realt.parser.ts falls back the same way).
    title: asText(ad.subject) ?? UNTITLED_LISTING,
    description: preview(ad.body_short),
    // Kufar counts in 1/100 of the currency (1385000 → 13850 BYN).
    priceByn: asPrice(ad.price_byn, { minorUnits: true }),
    priceUsd: asPrice(ad.price_usd, { minorUnits: true }),
    address: asText(param(ad.account_parameters, 'address')),
    listTime: ad.list_time,
    images: asTexts(asArray<unknown>(ad.images)?.map((image) => asRecord(image)?.path)).map(
      (path) => `${IMAGE_CDN_BASE}/${path}`,
    ),
    coordinates: asCoordinates(param(ad.ad_parameters, 'coordinates')),
    seller: asText(param(ad.account_parameters, 'name')),
    // Order is the card's reading order — what identifies the object first, extras last.
    details: listingDetails(
      detail('Тип', propertyType(ad)),
      detail('Площадь', asPositiveNumber(param(ad.ad_parameters, 'size')), 'м²'),
      detail('Участок', asPositiveNumber(param(ad.ad_parameters, 'size_area')), 'сот.'),
      // A dictionary field, not a count: measured 2026-10-06, `v` "6" is a studio and "5" reads
      // «5 и более» or «5+» by category — only the label is right.
      detail('Комнат', asText(param(ad.ad_parameters, 'rooms', 'vl'))),
      // Rent ads carry the storey and the building's height; a sale ad carries neither. Both
      // are positive-only: storeys here are 1-based, so a 0 is an unfilled field, not a basement.
      detail('Этаж', asPositiveNumber(param(ad.ad_parameters, 'floor'))),
      detail('Этажей', asPositiveNumber(param(ad.ad_parameters, 're_number_floors'))),
      detail('Год постройки', asPositiveNumber(param(ad.ad_parameters, 'year_built'))),
      ...facilities(ad),
    ),
  };
}

/**
 * The ad's own link when it is really a kufar address, otherwise one built from the id.
 *
 * `ad_link` is source-controlled text that we put inside `<a href="…">`. A value that is not an
 * http(s) kufar URL — another host, a `javascript:` scheme — is one Telegram can refuse, and a
 * card it refuses is never marked seen, so it would lead the batch again on every later run.
 */
function link(ad: RawKufarAd): string {
  const published = asText(ad.ad_link);
  return published !== undefined && matchesHost({ url: published, host: HOST })
    ? published
    : `https://re.kufar.by/vi/${ad.ad_id}`;
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

// kufar's own cut for a listing preview, measured on a live page: every long `body_short` is
// exactly this many characters, and it cuts mid-word with nothing to show for it.
const BODY_SHORT_CHARS = 150;

/** The listing preview, marked as cut when kufar cut it — otherwise it just stops mid-word. */
function preview(raw: string | undefined): string | undefined {
  const text = asText(raw);
  return text !== undefined && text.length >= BODY_SHORT_CHARS ? `${text}…` : text;
}

// One line per parameter, each under its own label. Lumping them together produced «Удобства:
// Центральное» — true of the heating, unreadable as a fact.
const FACILITY_LABELS: Array<[key: string, label: string]> = [
  ['re_heating', 'Отопление'],
  ['re_water', 'Вода'],
  ['re_hot_water', 'Горячая вода'],
  ['re_sewage', 'Канализация'],
  ['re_property_rights', 'Права'],
  // Long-term rent: what the flat comes with, and what the tenant pays up front.
  ['flat_repair', 'Ремонт'],
  ['flat_furnished', 'Мебель'],
  ['flat_rent_prepayment', 'Предоплата'],
  ['re_outbuildings', 'Постройки'],
  // A garage's amenities really are one list ("Свет, Охрана"), so they keep a shared label.
  ['garage_improvements', 'Удобства'],
];

function facilities(ad: RawKufarAd): Array<ReturnType<typeof detail>> {
  return FACILITY_LABELS.map(([key, label]) => {
    const value = param(ad.ad_parameters, key, 'vl');
    // A label can be a single string or a list (a garage has several) — both become one line.
    return detail(label, asTexts(value).join(', '));
  });
}
