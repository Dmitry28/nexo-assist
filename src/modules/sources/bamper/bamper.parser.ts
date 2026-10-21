import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { cardListings, elementText } from '../scraping/html';
import type { Protection } from '../scraping/ladder';
import { asPositiveNumber } from '../scraping/next-data';
import { UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** bamper.by — used car parts. */
export const HOST = 'bamper.by';

/** A parts search: /zchbu/zapchast_<part>/marka_<brand>/model_<model>/god_<years>/, any of them. */
export const SEARCH_PATH = /^\/zchbu(\/[a-z0-9_-]+)+$/;

/**
 * Cloudflare answers anything but a Belarusian IP with a 403 challenge (measured from Poland and
 * from the server); a free Belarusian proxy or the paid anti-bot tier gets the page, no render
 * needed (prototype on ScrapFly, ZenRows 2026-10-15). The results header marks the real page —
 * an empty search has it too (prototype: a part with no offers for weeks); it sits in an HTML
 * comment, which the challenge page does not carry either.
 */
export const PROTECTION: Protection = {
  usable: (html) => html.includes('Найдено объявлений'),
  country: 'by',
};

/**
 * A search page: one card per offer, found by its photo link — the one structural anchor that
 * survived the site's 09.2026 rebuild (the headline link repeats the href, without a title). No
 * pager is walked (protected: one page a poll).
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const cards = parse(html).querySelectorAll('a[href^="/zapchast_"][title]');
  return { listings: cardListings(cards, toListing, 'bamper') };
}

function toListing(photoLink: HTMLElement): Listing | undefined {
  const href = photoLink.getAttribute('href') ?? '';
  // <seller>-<articul>: the prototype's id, stable across the rebuild.
  const id = /^\/zapchast_[a-z0-9-]+\/([\w-]+)\/$/.exec(href)?.[1];
  const card = photoLink.parentNode;
  if (id === undefined || card === null) return undefined;
  const image = card
    .querySelector('img[src^="/upload/"], img[src^="https://"]')
    ?.getAttribute('src');
  return {
    externalId: id,
    link: new URL(href, `https://${HOST}`).toString(),
    // «Бампер задний к Volkswagen Atlas Cross Sport, 2025 г.»
    title: photoLink.getAttribute('title')?.trim() || UNTITLED_LISTING,
    description: elementText(card.querySelector('p.line-clamp-3')),
    priceByn: asPositiveNumber(
      card.querySelector('[data-price-byn]')?.getAttribute('data-price-byn'),
    ),
    address: elementText(card.querySelector('a[href^="/catalog/gorod_"] span')),
    // The card's date has no year («12.10»), so no listTime.
    listTime: '',
    images: image === undefined ? [] : [new URL(image, `https://${HOST}`).toString()],
    details: listingDetails(
      // «2.0 л, бензин, АКПП» — the donor car, next to the car icon.
      detail(
        'Авто',
        elementText(card.querySelector('use[href$="#car"]')?.parentNode?.nextElementSibling),
      ),
      // A badge of its own («87%»), not any percentage — a description may say «100% оригинал».
      detail(
        'Рейтинг продавца',
        card
          .querySelectorAll('span')
          .map((span) => elementText(span))
          .find((text) => text !== undefined && /^\d{1,3}%$/.test(text)),
      ),
    ),
  };
}
