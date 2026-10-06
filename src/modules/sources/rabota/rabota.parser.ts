import { parse } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import {
  asCoordinates,
  asNumber,
  asRecord,
  asText,
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

function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toListing(raw: RawVacancy): Listing {
  return {
    externalId: String(raw.vacancyId),
    // Built from the id: `links.desktop` can point at hh.ru instead (measured), while this URL
    // answers 200 on rabota.by for every vacancy.
    link: `https://${HOST}/vacancy/${raw.vacancyId}`,
    title: asText(raw.name) ?? UNTITLED_LISTING,
    priceText: salary(raw.compensation) ?? 'зарплата не указана',
    address: asText(raw.address?.displayName) ?? asText(raw.area?.name),
    listTime: asText(raw.publicationTime?.$) ?? '',
    images: [],
    // Named lat/lng here; asCoordinates reads the lon-first pair kufar and realt use.
    coordinates: asCoordinates([raw.address?.marker?.['@lng'], raw.address?.marker?.['@lat']]),
    seller: asText(raw.company?.visibleName) ?? asText(raw.company?.name),
    details: listingDetails(detail('Город', asText(raw.area?.name))),
  };
}

const CURRENCIES: Record<string, string> = {
  // hh still names the Belarusian ruble by its pre-2016 code.
  BYR: 'руб.',
  BYN: 'руб.',
  RUR: '₽',
  USD: '$',
  EUR: '€',
};
// MONTH needs no suffix. TODO [L]: hh may have other modes (seen live: MONTH, HOUR, SHIFT only).
const PER: Record<string, string> = { HOUR: ' в час', SHIFT: ' за смену' };

/** «1500 – 2000 руб.», «от 15 руб. в час, до вычета налогов» — or undefined when hh shows none. */
function salary(raw: RawVacancy['compensation']): string | undefined {
  const from = asNumber(raw?.from);
  const to = asNumber(raw?.to);
  // No code at all is assumed to be rubles — not seen live; every salary measured carried one.
  const code = asText(raw?.currencyCode) ?? 'BYR';
  const unit = `${CURRENCIES[code] ?? code}${PER[asText(raw?.mode) ?? ''] ?? ''}`;
  let amount: string;
  if (from !== undefined && to !== undefined) {
    amount = from === to ? `${from} ${unit}` : `${from} – ${to} ${unit}`;
  } else if (from !== undefined) amount = `от ${from} ${unit}`;
  else if (to !== undefined) amount = `до ${to} ${unit}`;
  else return undefined;
  return raw?.gross === true ? `${amount}, до вычета налогов` : amount;
}
