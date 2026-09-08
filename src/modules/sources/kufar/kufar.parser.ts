import { asArray, asRecord, asText, parseNextData } from '../scraping/next-data';
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
  account_parameters?: RawAccountParam[];
}

/** One entry of an ad's `account_parameters` block — a key/value pair, value untyped. */
interface RawAccountParam {
  p: string;
  v: unknown;
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
    address: asText(accountParam(ad, 'address')),
    listTime: ad.list_time,
    images: (ad.images ?? []).map((image) => `${IMAGE_CDN_BASE}/${image.path}`),
  };
}

// NOTE: Kufar stores prices as integers in 1/100 of the currency unit (1385000 → 13850 BYN).
// The positivity check comes AFTER the conversion: a raw value under 50 rounds to 0, and a
// `priceByn` of 0 is not a price — the digest would print "0 BYN" rather than "цена не указана".
function toPrice(raw: string | undefined): number | undefined {
  const value = Math.round(parseInt(raw ?? '', 10) / 100);
  return value > 0 ? value : undefined;
}

/** One of the ad's `account_parameters` by key — the block holding address, seller and so on. */
function accountParam(ad: RawKufarAd, key: string): unknown {
  return asArray<RawAccountParam>(ad.account_parameters)?.find((p) => p.p === key)?.v;
}
