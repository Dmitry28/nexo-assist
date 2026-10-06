import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { NO_SALARY } from '../listing-text';
import { elementText } from '../scraping/html';
import { timeAgo } from '../scraping/relative-time';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';

/** gsz.gov.by — the state vacancy bank (Госслужба занятости). */
export const HOST = 'gsz.gov.by';
/** Where a vacancy search lives — the only gsz page there is something to watch on. */
export const SEARCH_PATH = '/registration/vacancy-search/';

// The card's own detail link. Two things learned in the prototype: the site moved its ids from
// numbers to UUIDs and appended `?source=search` — so the id is matched loosely. The query is
// kept in the link: measured 2026-10-06, the same URL without it answers 500. The card's
// «Контакты» button matches this path too (with a numeric id) — reading only the title anchor
// (`.job-title a`) is what keeps it out.
const DETAIL_PATH = /^\/registration\/employer\/vacancy\/([\w-]+)\/detail-public\//;

// What the site prints for a search with no vacancies (measured) — the one case where zero
// cards is an answer rather than a layout change.
const NOTHING_FOUND = 'ничего не найдено';

/** One page of a gsz search: its vacancies and whether a later page exists. */
export interface GszPage {
  listings: Listing[];
  hasMore: boolean;
}

/**
 * Parse a gsz search page. Server-rendered HTML, no JSON blob: each vacancy is a `.job-block`
 * whose title links to its detail page. Zero cards without the «nothing found» text is a
 * redesign or a block page — a SourceUnavailableError, never an empty search.
 */
export function extractPage(html: string, page: number, now: Date): GszPage {
  const root = parse(html);
  const listings = root
    .querySelectorAll('.job-block')
    .map((card) => toListing(card, now))
    .filter((listing) => listing !== undefined);
  if (listings.length === 0 && !root.textContent.toLowerCase().includes(NOTHING_FOUND)) {
    throw new SourceUnavailableError('gsz: no vacancy cards — page layout changed?');
  }
  // The pager links every page by number, and a page past the end is a 404 (measured).
  const next = new RegExp(`[?&]page=${page + 1}(&|$)`);
  const hasMore = root
    .querySelectorAll('a.page-link')
    .some((a) => next.test(a.getAttribute('href') ?? ''));
  return { listings, hasMore };
}

function toListing(card: HTMLElement, now: Date): Listing | undefined {
  const anchor = card.querySelector('.job-title a');
  const href = anchor?.getAttribute('href');
  const id = href === undefined ? undefined : DETAIL_PATH.exec(href)?.[1];
  // Not a vacancy card (a promo block sharing the class): nothing to watch.
  if (href === undefined || id === undefined) return undefined;
  const salary = elementText(card.querySelector('.salary'));
  return {
    externalId: id,
    link: new URL(href, `https://${HOST}`).toString(),
    title: elementText(anchor) ?? UNTITLED_LISTING,
    priceText: salary ?? NO_SALARY,
    address: elementText(card.querySelector('.address')),
    listTime: updatedAt(card.textContent, now),
    images: [],
    seller: elementText(card.querySelector('.org a')),
    details: listingDetails(detail('Ставка', rate(card.textContent))),
  };
}

const rate = (cardText: string): string | undefined => /Ставка:\s*([\d.,]+)/.exec(cardText)?.[1];

/**
 * gsz prints only «Обновлено N дней назад» — the last UPDATE, not publication, and no date. Shown
 * on the card only (dedup is by id); text we cannot read leaves it empty rather than invent «now».
 */
function updatedAt(cardText: string, now: Date): string {
  // Only the «Обновлено …» phrase — a title or address may say «… назад» too.
  return timeAgo(/Обновлено[^\n<]*/.exec(cardText)?.[0] ?? '', now)?.toISOString() ?? '';
}
