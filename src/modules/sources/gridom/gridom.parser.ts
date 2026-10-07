import { detail, listingDetails } from '../listing-details';
import {
  asArray,
  asPositiveNumber,
  asPrice,
  asRecord,
  asText,
  asTexts,
  parseJson,
  requireArray,
  withIds,
} from '../scraping/next-data';
import { SourceUnavailableError, UNTITLED_LISTING } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { PageContext, SearchPage } from '../source-definition';

/** gridom.by — developers' sales widget (ЖК «Погораны» and others): every unit with its status. */
export const HOST = 'gridom.by';
/** A developer's page: /<slug> — the API behind it is /api/public/<slug>/config. */
// Not the widget's own service paths (measured in its bundle 2026-10-07); any other single segment
// is taken as a developer — a wrong one fails at poll time with «config is not JSON».
export const SEARCH_PATH = /^\/(?!(?:admin|api|present|data|login)$)[a-z0-9-]+$/;

/** The JSON the widget renders from — the pasted page is an app shell with no data. */
export const configUrl = (url: string): string =>
  `https://${HOST}/api/public/${slugOf(url)}/config`;

const slugOf = (url: string): string => new URL(url).pathname.replace(/^\/|\/$/g, '');

const ON_SALE = new Set(['free', 'shared']);

interface RawUnit {
  id?: unknown;
  number?: unknown;
  type?: unknown;
  status?: unknown;
  section?: unknown;
  floor?: unknown;
  rooms?: unknown;
  area?: unknown;
  price?: unknown;
  pricePerMeter?: unknown;
  photos?: unknown;
  dealType?: unknown;
}

/**
 * Units on sale now: `free`, and `shared` — «долевое строительство», a unit sold by a share deal
 * (the widget lists both as on sale; measured 2026-10-07: 6 free, 33 shared). Not `reserved`: it
 * can't be bought, and delivering it would mark it seen — if the reservation falls through, the
 * user would never hear it came back. Never `sold`.
 */
export function parsePage(json: string, { url }: PageContext): Omit<SearchPage<never>, 'next'> {
  const config = asRecord(parseJson(json));
  if (!config) throw new SourceUnavailableError('gridom: config is not JSON — API changed?');
  const project = asText(config.name);
  const units = withIds(
    // A null or a scalar among the units is no unit — dropped, not a TypeError on `.id`.
    requireArray<RawUnit>(config.units, 'gridom', 'units').filter((u) => asRecord(u) !== undefined),
    (u) => u.id,
    'gridom',
  );
  return {
    listings: units
      .filter((u) => ON_SALE.has(asText(u.status) ?? ''))
      .map((u) => toListing(u, project, url)),
  };
}

function toListing(unit: RawUnit, project: string | undefined, url: string): Listing {
  // withIds let only a usable id through: text, or a finite number.
  const id = typeof unit.id === 'number' ? String(unit.id) : (asText(unit.id) ?? '');
  const type = asText(unit.type);
  // `number` arrives as a number (1) — `asPositiveNumber` reads either spelling.
  const number = asPositiveNumber(unit.number);
  const area = asPositiveNumber(unit.area);
  return {
    externalId: id,
    // The widget has no per-unit page; its developer page with the unit's id.
    link: `https://${HOST}/${slugOf(url)}?unit=${encodeURIComponent(id)}`,
    title:
      [type, number && `№ ${number}`, area && `${area} м²`].filter(Boolean).join(', ') ||
      UNTITLED_LISTING,
    priceByn: asPrice(unit.price, { minorUnits: false }),
    address: project,
    listTime: '',
    // Photo paths carry Cyrillic file names — encoded, or Telegram can't fetch them.
    images: asTexts(asArray<unknown>(unit.photos)).map((path) =>
      encodeURI(`https://${HOST}${path}`),
    ),
    details: listingDetails(
      detail('Площадь', area, 'м²'),
      detail('Комнат', asPositiveNumber(unit.rooms)),
      detail('Этаж', asPositiveNumber(unit.floor)),
      detail('Цена за м²', asPositiveNumber(unit.pricePerMeter), 'BYN'),
      detail('Сделка', unit.status === 'shared' ? 'долевое строительство' : undefined),
    ),
  };
}
