import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { rangeText } from '../listing-text';
import { elementText, linkPath } from '../scraping/html';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** ghb.by — the state developer (Гродножилстрой / Белгосжилстрой) price list. */
export const HOST = 'ghb.by';
/** The price list — the one ghb page there is something to watch on. */
export const SEARCH_PATH = '/ru/construction/price_apartments/';

// An item links its object page under /ru/construction/<kind>/<id>/. Measured 2026-10-07: three
// kinds (nedvizhimost-dogovor — housing, nedvizhimost — offices, apartments) and the same object
// linked twice — so the id is the link's path (see linkPath).
const ITEM_PATH = /^\/ru\/construction\/(nedvizhimost-dogovor|nedvizhimost|apartments)\/(\d+)\/?$/;
const KIND: Record<string, string> = {
  'nedvizhimost-dogovor': 'Жильё',
  apartments: 'Жильё',
  nedvizhimost: 'Офисы',
};

// A per-m² price cell: «2 600,0», «2 480» — a thousands separator keeps out years, and only `td`
// cells are read, which keeps out the «1 взнос — от 73 000» header (a `th`). Offices also list a
// unit's total cost in kopecks («98 824,87», measured 2026-10-07) — at most ONE decimal digit
// keeps those out.
const PRICE_CELL = /^\d{1,2}\s\d{3}(?:,\d)?$/;
const REGISTRATION = /онлайн\s+регистрац|дата\s+начала\s+продаж|бронирование\s+квартир/i;

/**
 * The price list, one item per object. The list is short (13 measured) and holds no dates, so
 * there is no order to rely on — the window never fills. An empty list is a layout change:
 * the page always carries objects (if ghb ever sells out, polls fail — acceptable for now).
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const byId = new Map<string, Listing>();
  for (const anchor of parse(html).querySelectorAll('h3 a')) {
    const listing = toListing(anchor);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  if (byId.size === 0)
    throw new SourceUnavailableError('ghb: no price-list items — page layout changed?');
  return { listings: [...byId.values()] };
}

function toListing(anchor: HTMLElement): Listing | undefined {
  const match = ITEM_PATH.exec(linkPath(anchor.getAttribute('href'), HOST) ?? '');
  if (!match) return undefined;
  const id = `${match[1]}/${match[2]}`;
  // The item's cell in the outer table holds its title, paragraphs and price table.
  const cell = anchor.closest('td') ?? anchor;
  const prices = cell
    .querySelectorAll('td')
    .map((td) => elementText(td))
    .filter((text): text is string => text !== undefined && PRICE_CELL.test(text))
    .map((text) => Math.round(Number(text.replace(/\s/g, '').replace(',', '.'))));
  return {
    externalId: id,
    link: `https://${HOST}/ru/construction/${id}/`,
    title: elementText(anchor) ?? UNTITLED_LISTING,
    priceText:
      rangeText({
        from: prices.length > 0 ? Math.min(...prices) : undefined,
        to: prices.length > 0 ? Math.max(...prices) : undefined,
        unit: 'руб./м²',
      }) ?? 'цена не указана',
    listTime: '',
    images: [],
    details: listingDetails(
      detail('Тип', KIND[match[1]]),
      detail(
        'Продажи',
        cell
          .querySelectorAll('p')
          .map((p) => elementText(p))
          .find((text) => text !== undefined && REGISTRATION.test(text)),
      ),
    ),
  };
}
