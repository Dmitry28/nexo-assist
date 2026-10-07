import { parse } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { elementText } from '../scraping/html';
import { asPositiveNumber } from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** prometr.by — new-build catalogue: a complex page lists every unit for sale in it. */
export const HOST = 'prometr.by';
/** A complex page: /newbuild_belarus/<city>/<complex>/. */
export const SEARCH_PATH = /^\/newbuild_belarus\/[a-z0-9-]+\/[a-z0-9-]+$/;

// NOTE: read by splitting on the row's OPENING TAG, not with an HTML parser and not by class name.
// Measured 2026-10-07: an unclosed `<span class="flats-in__usd">` in every price cell makes the
// parser re-parent the rows (none found by selector), and the bare class name also occurs in an
// inline <style> — a phantom row for a class-name search (the prototype's gotcha too).
const ROW = '<div class="flats-in__row">';
const TABLE = 'class="flats-in"';
// The unit's own page; its trailing number is the unit id (the `_<n>` in the path is the building).
const UNIT_LINK = /href="(\/newbuild_belarus\/[^"]+-(\d+)\/)"/;
const PLAN_IMAGE = /data-src='([^']+)'/;

/**
 * The complex page, one listing per unit for sale. The page embeds every building's unit table
 * (measured on three complexes against their building pages — the prototype walked those), so
 * one request covers the complex.
 *
 * A sold-out complex has no unit table at all (measured: royal-park, gk-grand) — an empty list.
 * A table with no readable unit in it is a layout change (a renamed row class, say), which must
 * fail the poll rather than read as «sold out» forever.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const complex = elementText(parse(/<h1[^>]*>[\s\S]*?<\/h1>/.exec(html)?.[0] ?? ''));
  if (!complex) {
    throw new SourceUnavailableError('prometr: no complex title — page layout changed?');
  }
  const byId = new Map<string, Listing>();
  for (const row of html.split(ROW).slice(1)) {
    // A row runs to the next one; the last is cut after its unit link, not at the page footer.
    const end = row.indexOf('icons-arrow');
    const listing = toListing(end === -1 ? row : row.slice(0, end), complex);
    if (listing && !byId.has(listing.externalId)) byId.set(listing.externalId, listing);
  }
  if (byId.size === 0 && html.includes(TABLE)) {
    throw new SourceUnavailableError('prometr: a unit table with no units — page layout changed?');
  }
  return { listings: [...byId.values()] };
}

function toListing(row: string, complex: string): Listing | undefined {
  const link = UNIT_LINK.exec(row);
  if (!link) return undefined;
  const cells = elementText(parse(row)) ?? '';
  const rooms = field(cells, 'Комнат');
  const area = field(cells, 'ПЛОЩАДЬ М2');
  const image = PLAN_IMAGE.exec(row)?.[1];
  return {
    externalId: link[2],
    link: `https://${HOST}${link[1]}`,
    title:
      rooms !== undefined && area !== undefined ? `${rooms}-комн., ${area} м²` : UNTITLED_LISTING,
    priceByn: money(field(cells, 'ЦЕНА квартиры')),
    address: complex,
    listTime: '',
    images: image ? [`https://${HOST}${image}`] : [],
    details: listingDetails(
      detail('Площадь', area, 'м²'),
      detail('Комнат', rooms),
      detail('Цена за м²', money(field(cells, 'ЦЕНА ЗА М2')), 'BYN'),
    ),
  };
}

// A cell's value follows its label: «ПЛОЩАДЬ М2 87.64», «ЦЕНА квартиры 218 210 BYN». A decimal
// comma is read as a point; spaces (thousands) are dropped.
const field = (cells: string, label: string): number | undefined => {
  const raw = new RegExp(`${label}\\s+([\\d\\s.,]+?)(?:\\s+BYN|\\s+[А-ЯA-Z]|$)`, 'i').exec(
    cells,
  )?.[1];
  return asPositiveNumber(raw?.replace(/\s/g, '').replace(',', '.'));
};

const money = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.round(value);
