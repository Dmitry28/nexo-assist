import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { elementText, linkPath } from '../scraping/html';
import type { Protection } from '../scraping/ladder';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

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
 * Cloudflare answers every plain request with a 403 challenge, Belarusian proxies included; only a
 * rendering anti-bot service gets through (ScrapingAnt, ScraperAPI — measured 2026-10-15). The
 * cards are drawn by a script after load: without the wait the page comes back with none
 * (prototype). A real page has cards, or the «nothing found» block an empty search draws instead —
 * both drawn by the script: the unrendered page has neither (measured 2026-10-15).
 */
export const PROTECTION: Protection = {
  usable: (html) =>
    html.includes('class="item-horizontal lots-search') || html.includes('class="nothing-found'),
  // The prototype's measured settle time for the cards.
  renderWaitMs: 10_000,
};

/**
 * A search page: one card per lot — the first 50 by the pinned order, latest auction first; the
 * rest load by a script a fetched page cannot run.
 * TODO [M]: a lot auctioned before the 50th card's date is never seen — on a Camry search
 * (2026-10-15) the 50 ended at auctions a week out, so the nearest week went unseen; a broader
 * search leaves more. The page links the next 50 (`/app/search/request?…&page=2`), another paid
 * page; check the depth on real company searches.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const byId = new Map<string, Listing>();
  for (const card of parse(html).querySelectorAll('div.item-horizontal.lots-search')) {
    const listing = toListing(card);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  return { listings: [...byId.values()] };
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
    // TODO [L]: the bid.cars CDN refuses Telegram (prototype) — photos need the upload path
    // (PRODUCT_PLAN.md «Фото только по URL»).
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
