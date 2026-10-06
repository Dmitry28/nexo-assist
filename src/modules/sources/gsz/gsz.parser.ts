import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { asText } from '../scraping/next-data';
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
  const salary = text(card.querySelector('.salary'));
  return {
    externalId: id,
    link: new URL(href, `https://${HOST}`).toString(),
    title: text(anchor) ?? UNTITLED_LISTING,
    priceText: salary ?? 'зарплата не указана',
    address: text(card.querySelector('.address')),
    listTime: updatedAt(card.textContent, now),
    images: [],
    seller: text(card.querySelector('.org a')),
    details: listingDetails(detail('Ставка', rate(card.textContent))),
  };
}

// The tags' text with entities decoded and whitespace collapsed — gsz pads every field.
const text = (element: HTMLElement | null | undefined): string | undefined =>
  asText(element?.textContent.replace(/\s+/g, ' '));

const rate = (cardText: string): string | undefined => /Ставка:\s*([\d.,]+)/.exec(cardText)?.[1];

const UNIT_MS: Array<[RegExp, number]> = [
  [/^секунд/, 1000],
  [/^минут/, 60_000],
  [/^час/, 3_600_000],
  [/^(дн|ден)/, 86_400_000],
  [/^недел/, 7 * 86_400_000],
  [/^месяц/, 30 * 86_400_000],
  [/^(год|лет)/, 365 * 86_400_000],
];

/**
 * «Обновлено 5 дней назад» → an ISO time that far before `now`. Approximate by nature: the site
 * gives only this relative, coarse text (no date), and it is the last UPDATE, not publication.
 * Shown on the card only — dedup is by id. Text we cannot read falls back to `now`.
 */
export function updatedAt(cardText: string, now: Date): string {
  const match = /Обновлено\s+(\d+)\s+(\S+)\s+назад/.exec(cardText);
  const unit = match && UNIT_MS.find(([re]) => re.test(match[2]))?.[1];
  return new Date(now.getTime() - (unit ? Number(match[1]) * unit : 0)).toISOString();
}
