import { parseNextData } from '../next-data';
import type { Listing } from '../source-adapter';

/** Raw ad shape from Kufar's `__NEXT_DATA__` JSON — only the fields we read. */
interface RawKufarAd {
  ad_id: number;
  ad_link?: string;
  subject: string;
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

/** Parse a Kufar search page's `__NEXT_DATA__`. Returns an empty page on any parse failure. */
export function extractPage(html: string): KufarPage {
  const empty: KufarPage = { ads: [], nextCursor: null };
  const data = parseNextData(html);
  if (!data) return empty;

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  // NOTE: Kufar puts Redux state under props.pageProps.initialState or props.initialState.
  const initialState = (pageProps?.initialState ?? props?.initialState) as
    | Record<string, unknown>
    | undefined;
  const listing = initialState?.listing as Record<string, unknown> | undefined;
  const ads = (listing?.ads as RawKufarAd[] | undefined) ?? [];
  const pagination = (listing?.pagination as RawPagination[] | undefined) ?? [];
  const nextCursor = pagination.find((p) => p.label === 'next')?.token ?? null;
  return { ads, nextCursor };
}

/** Map a raw ad to a normalized listing. */
export function mapAd(ad: RawKufarAd): Listing {
  return {
    externalId: String(ad.ad_id),
    link: ad.ad_link ?? `https://re.kufar.by/vi/${ad.ad_id}`,
    title: ad.subject,
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
