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

const NEXT_DATA_OPEN = '<script id="__NEXT_DATA__" type="application/json">';
const IMAGE_CDN_BASE = 'https://rms.kufar.by/v1/list_thumbs_2x';

/** Extract the ads array from a Kufar search page's `__NEXT_DATA__`. Returns [] on any parse failure. */
export function extractAds(html: string): RawKufarAd[] {
  // NOTE: positional slice, not regex — the JSON contains '<' (titles/descriptions) that would truncate a pattern.
  const start = html.indexOf(NEXT_DATA_OPEN);
  if (start === -1) return [];
  const from = start + NEXT_DATA_OPEN.length;
  const end = html.indexOf('</script>', from);
  if (end === -1) return [];

  try {
    const data = JSON.parse(html.slice(from, end)) as Record<string, unknown>;
    const props = data.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    // NOTE: Kufar puts Redux state under props.pageProps.initialState or props.initialState.
    const initialState = (pageProps?.initialState ?? props?.initialState) as
      | Record<string, unknown>
      | undefined;
    const listing = initialState?.listing as Record<string, unknown> | undefined;
    return (listing?.ads as RawKufarAd[] | undefined) ?? [];
  } catch {
    return [];
  }
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
