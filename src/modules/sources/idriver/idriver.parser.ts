import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { matchesHost } from '@/common/url';

import { detail, listingDetails } from '../listing-details';
import { elementText } from '../scraping/html';
import type { Protection } from '../scraping/ladder';
import { asPositiveNumber } from '../scraping/next-data';
import { ruDate } from '../scraping/ru-date';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** idriver.by — used parts from Belarusian breakers' yards. */
export const HOST = 'idriver.by';
/** A model's catalogue, e.g. /auto-parts/volkswagen/atlas-cross-sport — every part of the car. */
export const SEARCH_PATH = /^\/auto-parts\/[a-z0-9-]+\/[a-z0-9-]+$/;

/**
 * The catalogue sits behind two gates (measured by the prototype, re-checked 2026-10-13): a 403
 * captcha for any non-Belarusian IP, and a 713-byte stub that reloads itself from a script — so
 * only a rendered page through a Belarusian proxy gets through. The sort control marks the real
 * page, the empty catalogue included; the stub and the captcha have none.
 */
export const PROTECTION: Protection = {
  usable: (html) => html.includes('id="selectSorter"'),
  country: 'by',
  // The prototype's measured settle time for the stub's reload.
  renderWaitMs: 8_000,
};

/**
 * A catalogue page: every offer is a schema.org Offer card, its id in the class
 * (`Element<id>`). No pager is walked — the first screen holds the 50 newest offers and a page
 * costs a paid render. The page passed `usable`, so no cards is an empty catalogue, not a block.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const byId = new Map<string, Listing>();
  for (const card of parse(html).querySelectorAll('li[itemtype="https://schema.org/Offer"]')) {
    const listing = toListing(card);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  return { listings: [...byId.values()] };
}

function toListing(card: HTMLElement): Listing | undefined {
  const id = /\bElement(\d+)\b/.exec(card.getAttribute('class') ?? '')?.[1];
  const href = card.querySelector('a[itemprop="url"]')?.getAttribute('href');
  if (id === undefined || href === undefined) return undefined;
  // City, seller, date — three spans in that order.
  const [city, seller, date] = card.querySelectorAll('.dop span').map((span) => elementText(span));
  return {
    externalId: id,
    link: new URL(href, `https://${HOST}`).toString(),
    title: elementText(card.querySelector('[itemprop="name"]')) ?? UNTITLED_LISTING,
    description: elementText(card.querySelector('.part_txt')),
    // The microdata price, not the visible one — that is formatted and may sit next to a converted one.
    priceByn: asPositiveNumber(
      card.querySelector('meta[itemprop="price"]')?.getAttribute('content'),
    ),
    address: city,
    seller,
    // The publication day only — no time, so no listTime: the card would print it as a time.
    listTime: '',
    images: leadPhoto(card),
    details: listingDetails(
      detail('Авто', autoSpec(card)),
      detail('Опубликовано', date === undefined ? undefined : ruDate(date)),
    ),
  };
}

/**
 * The card's first photo at full size — one, like the prototype: a part has up to 16, and a
 * feed of 50 parts as albums would bury the text. Telegram cannot fetch img*.idriver.by by URL,
 * so these go up as files (send-card.ts → photo-upload.ts). Measured 2026-10-19 from a home IP
 * (not yet from Hetzner): img77 serves them to anyone; the newest offers' img55 answers 404 even
 * from a Belarusian proxy — those cards arrive as text.
 */
function leadPhoto(card: HTMLElement): string[] {
  const src = card.querySelector('img[itemprop="image"]')?.getAttribute('src');
  const full = src?.replace(/_thumb(?=\.webp$)/, '');
  return full !== undefined && matchesHost({ url: full, host: HOST }) ? [full] : [];
}

/** «Авто: 2.0, Бензин, АКПП, Джип» — the donor car's engine and body. */
const autoSpec = (card: HTMLElement): string | undefined =>
  card
    .querySelectorAll('.params li')
    .map((li) => elementText(li))
    .find((text) => text?.startsWith('Авто:'))
    ?.replace(/^Авто:\s*/, '');
