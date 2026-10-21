import { matchesHost } from '@/common/url';

import { detail, listingDetails } from '../listing-details';
import { preview } from '../listing-text';
import { cardListings } from '../scraping/html';
import type { Protection } from '../scraping/ladder';
import {
  asArray,
  asPrice,
  asRecord,
  asText,
  parseNextData,
  requireArray,
  requireNextData,
  withIds,
  withoutStalePromos,
} from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** cars.av.by — the used-car board. */
export const HOST = 'cars.av.by';

/**
 * A brand, model or generation page: /volkswagen, /volkswagen/atlas, /volkswagen/atlas/<generation>.
 * Not /filter — since 06.10.2026 it ignores its query and serves the whole catalogue (the
 * prototype measured it, in a real browser too) — and not an advert, /<brand>/<model>/<number>.
 */
export const SEARCH_PATH = /^\/(?!filter$)[a-z0-9-]+(\/[a-z0-9-]+(\/(?!\d+$)[a-z0-9-]+)?)?$/;

/**
 * A SafeLine WAF answers anything but a Belarusian IP with 468 (measured from Poland and from the
 * server); a free Belarusian proxy or the paid anti-bot tier gets the page, no render needed
 * (measured on ZenRows, 2026-10-15). The search state marks the real page — not its adverts: an
 * empty search sends `adverts: null` (measured).
 */
export const PROTECTION: Protection = {
  usable: (html) => searchState(parseNextData(html)) !== undefined,
  country: 'by',
};

/** One advert as `__NEXT_DATA__` carries it — only the fields we read. */
interface RawAdvert {
  id: number;
  publicUrl?: string;
  description?: string;
  publishedAt?: string;
  renewedAt?: string;
  /** A paid «топ» — pinned to the top of the page whatever its age. */
  top?: boolean;
  sellerName?: string;
  locationName?: string;
  price?: { usd?: { amount?: number }; byn?: { amount?: number } };
  photos?: unknown;
  properties?: unknown;
}

const searchState = (data: Record<string, unknown> | null) =>
  asRecord(asRecord(asRecord(asRecord(data?.props)?.initialState)?.filter)?.main);

/**
 * One search page: the adverts the page was rendered with.
 * NOTE: av.by orders it «актуальные» and only its own API can re-sort (no URL parameter — measured
 * 2026-10-15), so the 25 on the page are not strictly the newest: an advert from page 2 that later
 * moves up arrives once as new. Same as the prototype, which read one page too.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const main = searchState(requireNextData(html, 'av-by'));
  // An empty search sends `adverts: null` with `count: 0` (measured); null on a search that has
  // adverts is a layout change.
  if (main?.count === 0) return { listings: [] };
  const adverts = withIds(
    requireArray<RawAdvert>(main?.adverts, 'av-by', 'filter.main.adverts'),
    (advert) => advert.id,
    'av-by',
  );
  // A paid «топ» older than the page would arrive as new each time the pool rotates (measured: a
  // 2025 advert topping a page of 2026 ones). Dated by the raise, the clock «актуальные» runs on.
  const fresh = withoutStalePromos(
    adverts,
    (advert) => advert.top === true,
    (advert) => raisedAt(advert),
  );
  return { listings: cardListings(fresh, toListing, 'av-by') };
}

/** When the advert was last raised, or published if never — what the page orders by. */
const raisedAt = (advert: RawAdvert): string | undefined =>
  asText(advert.renewedAt) ?? asText(advert.publishedAt);

/**
 * A listing, or undefined for an advert without its own av.by link — source text goes inside
 * `<a href>` (kufar.parser explains why it is checked), and every advert measured carries one.
 */
function toListing(advert: RawAdvert): Listing | undefined {
  const link = asText(advert.publicUrl);
  if (link === undefined || !matchesHost({ url: link, host: HOST })) return undefined;
  // Every property is { name, value }; a value is text or a number (year, mileage).
  const prop = (name: string): string | undefined => {
    const value = asArray<unknown>(advert.properties)
      ?.map(asRecord)
      .find((p) => p?.name === name)?.value;
    return typeof value === 'number' ? String(value) : asText(value);
  };
  const title = [prop('brand'), prop('model'), prop('year')].filter(Boolean).join(' ');
  return {
    externalId: String(advert.id),
    link,
    title: title || UNTITLED_LISTING,
    description: preview(asText(advert.description)),
    priceUsd: asPrice(advert.price?.usd?.amount, { minorUnits: false }),
    priceByn: asPrice(advert.price?.byn?.amount, { minorUnits: false }),
    address: asText(advert.locationName),
    seller: asText(advert.sellerName),
    // A raised advert climbs back up the page — its raise time is the one a reader sees.
    listTime: raisedAt(advert) ?? '',
    images: photo(advert),
    details: listingDetails(
      detail('Пробег', prop('mileage_km'), 'км'),
      detail('Двигатель', [prop('engine_capacity'), prop('engine_type')].filter(Boolean).join(' ')),
      detail('Коробка', prop('transmission_type')),
      detail('Кузов', prop('body_type')),
      detail('Привод', prop('drive_type')),
      detail('Цвет', prop('color')),
    ),
  };
}

// The main photo's jpg: `big` is .avif, which Telegram does not show.
function photo(advert: RawAdvert): string[] {
  const photos = asArray<Record<string, unknown>>(advert.photos) ?? [];
  const main = photos.find((p) => p.main === true) ?? photos[0];
  const url = asText(asRecord(main?.medium)?.url);
  return url === undefined ? [] : [url];
}
