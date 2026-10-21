import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { cardListings, elementText, linkPath } from '../scraping/html';
import { fetchHtml, hasProxy } from '../scraping/http';
import {
  asCoordinates,
  asRecord,
  asText,
  asTexts,
  parseJson,
  requireArray,
} from '../scraping/next-data';
import { SearchRewrittenError, SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { Get, SearchPage } from '../source-definition';

import { fromAuctions } from './bid-cars.auctions';

/** bid.cars — US salvage-car auctions (Copart, IAAI). */
export const HOST = 'bid.cars';

/** The search results, in any of the site's languages: /ru/search/results?…. */
export const SEARCH_PATH = /^\/([a-z]{2}\/)?search\/results$/;

/** The Russian page whatever the link's language: the parser reads the cards by their labels. */
export function requestUrl(url: string): string {
  const russian = new URL(url);
  russian.pathname = '/ru/search/results';
  return russian.toString();
}

/**
 * A rendered search: cards, or the «nothing found» block. A Cloudflare challenge and the
 * unrendered shell have neither (measured 2026-10-15).
 */
export const isUsable = (html: string): boolean =>
  html.includes('class="item-horizontal lots-search') || html.includes('class="nothing-found');

/**
 * The pasted page when it opens, else Copart+IAAI for the same filters. A challenge or HTTP
 * error is not a verdict on the search — an empty bid.cars page is, and does not fall through.
 */
export async function load(url: string, get: Get): Promise<string> {
  const page = await tryBidCars(url, get);
  if (page !== undefined) return page;
  return JSON.stringify({ listings: await fromAuctions(url) });
}

async function tryBidCars(url: string, get: Get): Promise<string | undefined> {
  const attempts = [
    () => get(url),
    ...(hasProxy() ? [() => fetchHtml({ url, host: HOST, useProxy: true })] : []),
  ];
  for (const run of attempts) {
    try {
      const html = await run();
      if (isUsable(html)) return html;
    } catch (err) {
      if (!(err instanceof SourceUnavailableError) || err instanceof SearchRewrittenError) {
        throw err;
      }
    }
  }
  return undefined;
}

/**
 * A search page: bid.cars HTML (first 50, latest auction first) or the auction fallback JSON.
 * TODO [M]: a lot auctioned before the 50th card's date is never seen on the HTML path — on a
 * Camry search (2026-10-15) the 50 ended at auctions a week out; the fallback walks Copart's
 * 500-listing window instead.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  if (!isUsable(html)) return { listings: fallbackListings(html) };
  const cards = parse(html).querySelectorAll('div.item-horizontal.lots-search');
  return { listings: cardListings(cards, toListing, 'bid-cars') };
}

function toListing(card: HTMLElement): Listing | undefined {
  const titleLink = card.querySelector('a.item-title');
  // The lot number, «1-70620816» (Copart) or «0-46065866» (IAAI).
  const lot = card.getAttribute('id');
  if (!lot || titleLink === null) return undefined;
  const path = linkPath(titleLink.getAttribute('href'), HOST);
  if (path === undefined) return undefined;
  const fact = facts(card);
  const seller = fact.get('Продавец');
  return {
    externalId: lot,
    link: `https://${HOST}${path}`,
    title: elementText(titleLink) ?? UNTITLED_LISTING,
    // A bid moves every hour: text, so it is never reported as a price change (price-change.ts).
    priceText: bids(card.querySelector('.price-box')),
    address: fact.get('Место расположение'),
    seller: seller === '---' ? undefined : seller,
    // The card shows when the auction starts, not when the lot was listed.
    listTime: '',
    // TODO [L]: the bid.cars CDN refuses Telegram (prototype). The upload path exists
    // (photo-upload.ts) — measure whether the CDN serves our server, behind the site's Cloudflare.
    images: [],
    details: listingDetails(
      detail('VIN', elementText(card.querySelector('.vin_title'))),
      detail('Аукцион', auction(card)),
      detail('Пробег', fact.get('Километраж')),
      detail('Повреждение', fact.get('Повреждение')),
      detail('Документ', fact.get('Док. продажи')),
      detail('Состояние', fact.get('Статус')),
      detail('Двигатель', engine(card)),
      detail('Оценка', elementText(card.querySelector('.estimated_price'))),
    ),
  };
}

/** The card's «Label: value» lines, by label. */
function facts(card: HTMLElement): Map<string, string> {
  const lines = new Map<string, string>();
  for (const li of card.querySelectorAll('.item-specs li')) {
    const label = elementText(li.querySelector('span'));
    const text = elementText(li);
    if (label === undefined || text === undefined) continue;
    const value = text.slice(label.length).trim();
    if (value) lines.set(label.replace(/:$/, ''), value);
  }
  return lines;
}

/** «Текущая ставка: $25 · Купить сейчас: $14,125» — one line per figure the box shows. */
function bids(box: HTMLElement | null): string | undefined {
  if (box === null) return undefined;
  const rows = box.querySelectorAll('div');
  const lines = (rows.length > 0 ? rows : [box])
    .map((row) => elementText(row)?.replace(/:\s*/, ': '))
    .filter((line) => line !== undefined);
  return lines.length > 0 ? lines.join(' · ') : undefined;
}

/** «COPART, чт 15 окт., 03:00 GMT+2» — the auction house and when its live sale starts. */
const auction = (card: HTMLElement): string | undefined =>
  [
    elementText(card.querySelector('.item-seller'))?.toUpperCase(),
    elementText(card.querySelector('.date')),
  ]
    .filter(Boolean)
    .join(', ');

/** «2.0L 4 cyl. 269HP» — the spec icons carry the rest as images. */
const engine = (card: HTMLElement): string | undefined =>
  card
    .querySelectorAll('.specs > span')
    .map((span) => elementText(span))
    .filter(Boolean)
    .join(' ');

function fallbackListings(body: string): Listing[] {
  const root = asRecord(parseJson(body));
  return requireArray<unknown>(root?.listings, 'bid-cars', 'listings').map(asFallbackListing);
}

function asFallbackListing(value: unknown): Listing {
  const row = asRecord(value);
  const externalId = asText(row?.externalId);
  const link = asText(row?.link);
  const title = asText(row?.title);
  if (row === undefined || externalId === undefined || link === undefined || title === undefined) {
    throw new SourceUnavailableError('bid-cars: fallback listing missing id/link/title');
  }
  const details = Array.isArray(row.details)
    ? row.details.flatMap((item) => {
        const line = asRecord(item);
        const label = asText(line?.label);
        const lineValue = asText(line?.value);
        return label === undefined || lineValue === undefined ? [] : [{ label, value: lineValue }];
      })
    : [];
  const pin = asRecord(row.coordinates);
  return {
    externalId,
    link,
    title,
    priceText: asText(row.priceText),
    address: asText(row.address),
    seller: asText(row.seller),
    listTime: asText(row.listTime) ?? '',
    images: asTexts(row.images),
    details,
    coordinates: asCoordinates([pin?.lon, pin?.lat]),
  };
}
