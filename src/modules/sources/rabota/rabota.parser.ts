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
  area?: { name?: unknown };
  address?: { displayName?: unknown; marker?: { '@lat'?: unknown; '@lng'?: unknown } };
}

/** One page of a rabota search: its vacancies and whether a later page exists. */
export interface RabotaPage {
  listings: Listing[];
  hasMore: boolean;
}

/**
 * Parse a rabota search page. hh renders the search into JSON inside
 * `<template id="HH-Lux-InitialState">` (entity-encoded; the parser decodes it). An anti-bot page
 * has no such template — the prototype met one in production — so a missing or unreadable state
 * is a SourceUnavailableError, never an empty search; a real zero-result page carries `[]`.
 */
export function extractPage(html: string): RabotaPage {
  const template = parse(html).querySelector('template#HH-Lux-InitialState');
  const result = asRecord(asRecord(parseJson(template?.textContent))?.vacancySearchResult);
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
  const next = asRecord(asRecord(result.paging)?.next);
  return {
    listings: vacancies.map(toListing),
    hasMore: next !== undefined && next.disabled !== true,
  };
}

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
