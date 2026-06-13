/** Raw ad shape from Kufar's `__NEXT_DATA__` JSON — only the fields we read. */
export interface RawKufarAd {
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

/** A parsed Kufar listing (lean — display fields only for now). */
export interface KufarListing {
  /** Stable id — unchanged when the ad is bumped; the diff/dedup key later. */
  adId: number;
  link: string;
  title: string;
  description?: string;
  priceByn?: number;
  priceUsd?: number;
  address?: string;
  /** ISO 8601 timestamp of the last bump. */
  listTime: string;
  images: string[];
}
