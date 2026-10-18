import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { elementText, linkPath } from '../scraping/html';
import { fetchJson } from '../scraping/http';
import { asText } from '../scraping/next-data';
import { SourceUnavailableError } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** iaai.com — US salvage auctions; the site's own search, no Cloudflare. */
export const HOST = 'iaai.com';

/** The inventory search: /Search?Keyword=…. */
export const SEARCH_PATH = /^\/Search$/;

const SEARCH_API = 'https://www.iaai.com/Search';
const PAGE_SIZE = 100;
const CARD_WALK_DEPTH = 8;
/** Flip with the source's `useProxy` — POST bypasses `get`, so the flag must live here too. */
export const USE_PROXY = false;

/** One page of lots for the pasted Keyword, latest auction first (the site's own sort). */
export function load(url: string): Promise<string> {
  return fetchJson({
    url: SEARCH_API,
    host: HOST,
    body: JSON.stringify(searchBody(url)),
    useProxy: USE_PROXY,
    headers: {
      Accept: 'text/html',
      'Content-Type': 'application/json',
      Origin: 'https://www.iaai.com',
      Referer: 'https://www.iaai.com/Search',
    },
  });
}

/** The POST the iaai.com pager sends — Keyword from the link, nothing the link did not ask for. */
export function searchBody(url: string): Record<string, unknown> {
  const keyword = asText(new URL(url).searchParams.get('Keyword')) ?? '';
  return {
    Searches: [{ FullSearch: keyword }],
    PageSize: PAGE_SIZE,
    CurrentPage: 1,
    ReturnFacets: false,
    Sort: [{ SortField: 'AuctionDateTime', IsDescending: true, IsGeoSort: false }],
  };
}

/**
 * Cards from a search page or a pager fragment. A bare challenge/empty HTML has none of the
 * search chrome — that is the source not answering, never an empty board.
 */
export function listingsFrom(html: string): Listing[] {
  if (!isSearchPage(html)) {
    throw new SourceUnavailableError('iaai: search markup missing — page layout changed?');
  }
  const byId = new Map<string, Listing>();
  for (const link of parse(html).querySelectorAll('a[href*="/VehicleDetail/"]')) {
    const listing = toListing(link);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  return [...byId.values()];
}

export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  return { listings: listingsFrom(html) };
}

const isSearchPage = (html: string): boolean =>
  html.includes('data-list--search') ||
  html.includes('TotalVehicleAmount') ||
  html.includes('data-resultcount');

function toListing(titleLink: HTMLElement): Listing | undefined {
  const title = elementText(titleLink);
  // Image links hit the same /VehicleDetail/ href; the titled heading starts with the year.
  if (title === undefined || !/^\d{4}\s/.test(title)) return undefined;
  const path = linkPath(titleLink.getAttribute('href'), HOST);
  if (path === undefined) return undefined;
  const id = inventoryId(path);
  if (id === undefined) return undefined;
  const card = cardOf(titleLink);
  const fact = facts(card);
  const image = card
    .querySelectorAll('img')
    .map((img) => asText(img.getAttribute('data-src')) ?? asText(img.getAttribute('src')))
    .find((src) => src?.startsWith('https://'));
  return {
    externalId: id,
    link: `https://${HOST}${path}`,
    title,
    priceText: buyNow(card) ?? estimate(fact.get('ACV')),
    address: fact.get('Branch'),
    listTime: '',
    images: image === undefined ? [] : [image],
    details: listingDetails(
      detail('VIN', maskedVin(fact.get('VIN'))),
      detail('Аукцион', 'IAAI'),
      detail('Stock', fact.get('Stock #') ?? fact.get('Stock #:')),
      detail('Пробег', fact.get('Odometer')),
      detail('Повреждение', fact.get('Primary Damage')),
      detail('Документ', fact.get('Title/Sale Doc')),
      detail('Ключи', fact.get('Key')),
    ),
  };
}

/** Walk up until the parent holds more than one titled lot — the card, not the whole table. */
function cardOf(link: HTMLElement): HTMLElement {
  let card = link;
  for (let i = 0; i < CARD_WALK_DEPTH; i++) {
    const parent = card.parentNode;
    if (parent === null || titledLots(parent) > 1) break;
    card = parent;
  }
  return card;
}

const titledLots = (node: HTMLElement): number =>
  node
    .querySelectorAll('a[href*="/VehicleDetail/"]')
    .filter((link) => /^\d{4}\s/.test(elementText(link) ?? '')).length;

/** `title="Primary Damage: Flood"` — the card's labelled facts, by the site's English key. */
function facts(card: HTMLElement): Map<string, string> {
  const lines = new Map<string, string>();
  for (const el of card.querySelectorAll('[title]')) {
    const raw = asText(el.getAttribute('title'));
    if (raw === undefined) continue;
    const split = raw.indexOf(':');
    if (split === -1) continue;
    const label = raw.slice(0, split).replace(/:$/, '').trim();
    const value = raw.slice(split + 1).trim();
    if (label && value) lines.set(label, value);
  }
  return lines;
}

const buyNow = (card: HTMLElement): string | undefined => {
  const text = elementText(card);
  const match = text?.match(/Buy Now\s+(\$[\d,]+)/i);
  return match ? `Купить сейчас: ${match[1]}` : undefined;
};

const estimate = (acv: string | undefined): string | undefined =>
  acv === undefined ? undefined : `Оценка: ${acv.replace(/\s+USD$/i, '')}`;

const inventoryId = (path: string): string | undefined => path.match(/\/VehicleDetail\/(\d+)/)?.[1];

const maskedVin = (vin: string | undefined): string | undefined =>
  vin !== undefined && !vin.includes('*') ? vin : undefined;
