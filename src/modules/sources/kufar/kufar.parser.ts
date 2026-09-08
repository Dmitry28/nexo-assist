import { asRecord, parseNextData } from '../scraping/next-data';
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
  images?: Array<{ path: string }>;
  account_parameters?: Array<{ p: string; v: unknown }>;
}

const IMAGE_CDN_BASE = 'https://rms.kufar.by/v1/list_thumbs_2x';

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
  const ads = listing?.ads as RawKufarAd[] | undefined;
  if (!Array.isArray(ads)) throw new Error('kufar: listing.ads missing — page layout changed?');
  // Array-checked like `ads`: a `pagination` of another shape would otherwise throw
  // "find is not a function" instead of naming the page as the thing that changed.
  const rawPagination = listing?.pagination;
  const pagination = Array.isArray(rawPagination) ? (rawPagination as RawPagination[]) : [];
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
    title: ad.subject?.trim() || UNTITLED_LISTING,
    description: ad.body_short?.trim() || undefined,
    priceByn: toPrice(ad.price_byn),
    priceUsd: toPrice(ad.price_usd),
    address: getAddress(ad),
    listTime: ad.list_time,
    images: (ad.images ?? []).map((image) => `${IMAGE_CDN_BASE}/${image.path}`),
  };
}

// NOTE: Kufar stores prices as integers in 1/100 of the currency unit (1385000 → 13850 BYN).
function toPrice(raw: string | undefined): number | undefined {
  const value = raw ? parseInt(raw, 10) : 0;
  return value > 0 ? Math.round(value / 100) : undefined;
}

function getAddress(ad: RawKufarAd): string | undefined {
  const value = ad.account_parameters?.find((p) => p.p === 'address')?.v;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
