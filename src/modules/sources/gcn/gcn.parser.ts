import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { elementText, linkPath } from '../scraping/html';
import { asPositiveNumber, asRecord, asText, parseJson } from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { Get, SearchPage } from '../source-definition';

/** gcn.by — Гродненский центр недвижимости: state land and property auctions. */
export const HOST = 'gcn.by';
/** A catalogue section, e.g. /zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/. */
// Not a lot page (/properties/<slug>/): it has no grid.
export const SEARCH_PATH = /^\/(?!properties\/)[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/**
 * The grid behind a catalogue page. The page is a WPBakery lazy grid: no lots in its HTML, only
 * the grid's settings, its request URL and a public nonce (rotating, ~12–24 h) — so the request is
 * rebuilt from the page every poll (measured 2026-10-07; the prototype drove a browser for this).
 */
export async function load(url: string, get: Get): Promise<string> {
  const grid = parse(await get(url)).querySelector('[data-vc-grid-settings]');
  const settings = asRecord(parseJson(grid?.getAttribute('data-vc-grid-settings')));
  const request = grid?.getAttribute('data-vc-request');
  const nonce = grid?.getAttribute('data-vc-public-nonce');
  const postId = grid?.getAttribute('data-vc-post-id');
  if (!settings || !request || !nonce || !postId) {
    throw new SourceUnavailableError('gcn: no lot grid on the page — page layout changed?');
  }
  const query = new URLSearchParams({
    action: 'vc_get_vc_grid_data',
    tag: asText(settings.tag) ?? '',
    vc_post_id: postId,
    _vcnonce: nonce,
  });
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string' || typeof value === 'number')
      query.set(`data[${key}]`, String(value));
  }
  return get(`${new URL(request, `https://${HOST}`).href}?${query}`);
}

/**
 * The grid's lots. A rejected nonce answers 200 with the body «0» (measured) — no grid markup at
 * all, a source error; grid markup with no lots is a section with no auctions right now (assumed:
 * an empty section was not seen live).
 */
export function parsePage(body: string): Omit<SearchPage<never>, 'next'> {
  if (!body.includes('vc_grid')) {
    throw new SourceUnavailableError(
      'gcn: the grid request was refused — nonce or layout changed?',
    );
  }
  const byId = new Map<string, Listing>();
  for (const item of parse(body).querySelectorAll('.vc_grid-item')) {
    const listing = toListing(item);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  return { listings: [...byId.values()] };
}

function toListing(item: HTMLElement): Listing | undefined {
  const path = linkPath(
    item.querySelector('a.vc-zone-link, a.vc_gitem-link')?.getAttribute('href'),
    HOST,
  );
  if (path === undefined || !path.startsWith('/properties/')) return undefined;
  const excerpt = elementText(item.querySelector('.vc_gitem-post-data-source-post_excerpt')) ?? '';
  const imagePath = linkPath(item.querySelector('img')?.getAttribute('src'), HOST);
  return {
    externalId: path,
    // The site serves http without redirecting; the card links https.
    link: `https://${HOST}${path}`,
    title:
      elementText(item.querySelector('.vc_gitem-post-data-source-post_title')) ?? UNTITLED_LISTING,
    address: after(excerpt, 'Адрес:', 'Площадь:'),
    listTime: '',
    images: imagePath ? [`https://${HOST}${imagePath}`] : [],
    details: listingDetails(
      detail('Участок', after(excerpt, 'Площадь:', 'Кадастровый')),
      detail('Кадастровый номер', /Кадастровый номер:\s*(\d+)/.exec(excerpt)?.[1]),
    ),
  };
}

/** The lot page: the starting price (only there) and the utilities line, when present. */
export async function enrich(
  listing: Listing,
  get: (url: string) => Promise<string>,
): Promise<Listing> {
  // The whole page's text, not a block: the price sits in the post body, whose markup varies.
  const text = elementText(parse(await get(listing.link))) ?? '';
  // «34 294,00 руб.» measured; «бел. руб.» and «BYN» read the same.
  // TODO [L]: a miss (new wording) delivers the lot without a price, silently — no logger here.
  const price = /Начальная цена:\s*([\d\s]+(?:,\d+)?)\s*(?:бел\.?\s*)?(?:руб|BYN)/.exec(text)?.[1];
  const utilities = /(Имеется возможность подключения[^.]*\.)/.exec(text)?.[1];
  return {
    ...listing,
    priceByn: asPositiveNumber(price?.replace(/\s/g, '').replace(',', '.')),
    details: [...listing.details, ...listingDetails(detail('Коммуникации', utilities))],
  };
}

// The text between two labels of the excerpt: «Адрес: г. Гродно, … Площадь: …». The labels are
// constants (no escaping needed); elementText has collapsed the whitespace, so `.` spans it.
const after = (text: string, label: string, until: string): string | undefined =>
  asText(new RegExp(`${label}\\s*(.+?)\\s*(?:${until}|$)`).exec(text)?.[1]);
