import { parse } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { NO_SALARY, asPayPeriod, salaryText } from '../listing-text';
import { asCurrency } from '../scraping/currency';
import {
  asCoordinates,
  asNumber,
  asRecord,
  asText,
  parseJson,
  requireArray,
  withIds,
  withoutStalePromos,
} from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import { GONE } from '../source-definition';
import type { SearchPage } from '../source-definition';

/** rabota.by — hh.ru's Belarusian site. */
export const HOST = 'rabota.by';
/** Where a vacancy search lives — the only page there is something to watch on. */
export const SEARCH_PATH = '/search/vacancy';

/** Raw vacancy from the page's initial state — only the fields we read. */
interface RawVacancy {
  vacancyId: number;
  name?: unknown;
  /** A promoted vacancy, pinned to the top of a page whatever its date (measured: weeks old). */
  '@isAdv'?: unknown;
  company?: { visibleName?: unknown; name?: unknown };
  compensation?: {
    from?: unknown;
    to?: unknown;
    currencyCode?: unknown;
    /** Before tax — hh shows «до вычета налогов» next to such a salary. */
    gross?: unknown;
    /** MONTH, HOUR, SHIFT… — an hourly «15 руб.» must not read as a monthly one. */
    mode?: unknown;
  };
  publicationTime?: { $?: unknown };
  /** On a vacancy's own page, in place of `publicationTime`. */
  publicationTimeIso?: unknown;
  /** On a vacancy's own page: a closed one stays up, `archived` (measured 2026-10-19). */
  status?: { archived?: unknown };
  area?: { name?: unknown };
  address?: { displayName?: unknown; marker?: { '@lat'?: unknown; '@lng'?: unknown } };
}

/**
 * Parse a rabota search page. hh renders the search into JSON inside
 * `<template id="HH-Lux-InitialState">` (entity-encoded; the parser decodes it). An anti-bot page
 * has no such template — the prototype met one in production — so a missing or unreadable state
 * is a SourceUnavailableError, never an empty search; a real zero-result page carries `[]`.
 */
export function parsePage(html: string): SearchPage<boolean> {
  const result = asRecord(initialState(html)?.vacancySearchResult);
  if (!result) {
    throw new SourceUnavailableError('rabota: no search state on the page — anti-bot or redesign?');
  }
  const vacancies = withoutStalePromos(
    withIds(
      requireArray<RawVacancy>(result.vacancies, 'rabota', 'vacancySearchResult.vacancies'),
      (v) => v.vacancyId,
      'rabota',
    ),
    (v) => v['@isAdv'] === true,
    (v) => v.publicationTime?.$,
  );
  // `paging` is absent on a single page; `next.disabled` marks the last one (measured).
  const pager = asRecord(asRecord(result.paging)?.next);
  return {
    listings: vacancies.map(toListing),
    next: pager !== undefined && pager.disabled !== true,
  };
}

/** hh's page state — the JSON in `<template id="HH-Lux-InitialState">`; never throws. */
const initialState = (html: string): Record<string, unknown> | undefined =>
  asRecord(parseJson(parse(html).querySelector('template#HH-Lux-InitialState')?.textContent));

/**
 * One vacancy from its own page (`/vacancy/<id>`): the search's vacancy shape (measured
 * 2026-10-19), or GONE once closed — a closed vacancy stays up with `status.archived` (11 of 15
 * old ones). The salary also goes in as a number, so a changed one reads as a price change; the
 * card still shows it as text.
 */
export function parseItem(html: string): Listing | typeof GONE {
  const view = asRecord(asRecord(initialState(html)?.vacancyView)?.vacancyFull);
  const vacancy = asRecord(view?.vacancy);
  // The search page's checks, on a list of one: a missing vacancy or id is a layout change.
  const [raw] = withIds(
    requireArray<RawVacancy>(vacancy && [vacancy], 'rabota', 'vacancyView.vacancyFull.vacancy'),
    (v) => v.vacancyId,
    'rabota',
  );
  // NOTE: only `archived` is read — `disabled` / `hiddenInArchive` were never seen set on their own.
  if (raw.status?.archived === true) return GONE;
  // NOTE: the number compared is the lower bound (else the upper), in BYN or USD only: a change of
  // the other bound or of the period (`mode`) alone is no «💸», another currency never is.
  const pay = asNumber(raw.compensation?.from) ?? asNumber(raw.compensation?.to);
  const currency = asCurrency(raw.compensation?.currencyCode) ?? 'BYN';
  return {
    ...toListing({ ...raw, publicationTime: { $: raw.publicationTimeIso } }),
    priceByn: currency === 'BYN' ? pay : undefined,
    priceUsd: currency === 'USD' ? pay : undefined,
  };
}

/** rabota's 404 for an unknown vacancy carries `errorCode: 404` in its state (measured). */
export const isGoneItem = (notFoundHtml: string): boolean =>
  initialState(notFoundHtml)?.errorCode === 404;

function toListing(raw: RawVacancy): Listing {
  return {
    externalId: String(raw.vacancyId),
    // Built from the id: `links.desktop` can point at hh.ru instead (measured), while this URL
    // answers 200 on rabota.by for every vacancy.
    link: `https://${HOST}/vacancy/${raw.vacancyId}`,
    title: asText(raw.name) ?? UNTITLED_LISTING,
    priceText: salary(raw.compensation) ?? NO_SALARY,
    address: asText(raw.address?.displayName) ?? asText(raw.area?.name),
    listTime: asText(raw.publicationTime?.$) ?? '',
    images: [],
    // Named lat/lng here; asCoordinates reads the lon-first pair kufar and realt use.
    coordinates: asCoordinates([raw.address?.marker?.['@lng'], raw.address?.marker?.['@lat']]),
    seller: asText(raw.company?.visibleName) ?? asText(raw.company?.name),
    details: listingDetails(detail('Город', asText(raw.area?.name))),
  };
}

// A salary without a currency code is assumed to be rubles — not seen live; every one measured
// carried a code.
function salary(raw: RawVacancy['compensation']): string | undefined {
  return salaryText({
    from: asNumber(raw?.from),
    to: asNumber(raw?.to),
    currency: asCurrency(raw?.currencyCode) ?? 'BYN',
    period: asPayPeriod(raw?.mode),
    gross: raw?.gross === true,
  });
}
