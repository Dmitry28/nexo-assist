import type { ListingDetail } from './source-adapter';

/**
 * Placeholders the sources themselves store in a dictionary field a seller left blank. Dropping
 * them here keeps «Год постройки: Не указано» out of every detail line — and out of every
 * adapter's conditionals. Only details pass through here; `address` and `seller` are free text,
 * where these exact strings are not how a source spells "empty".
 */
const PLACEHOLDER_VALUES = new Set(['не указано', 'не указан', 'не указана', 'n/a']);

/**
 * A labelled detail, or `undefined` when the source left the field empty — pass the result to
 * `listingDetails`, which drops the gaps.
 *
 * Numbers are stringified as they came: an area is `114.6`, not a rounded `115`. Only prices
 * get thousands separators, and those are core fields, not details.
 */
export function detail(
  label: string,
  value: string | number | undefined,
  unit?: string,
): ListingDetail | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (text === '' || PLACEHOLDER_VALUES.has(text.toLowerCase())) return undefined;
  return { label, value: unit === undefined ? text : `${text} ${unit}` };
}

/** The details an adapter managed to fill, in the order it listed them. */
export const listingDetails = (...items: Array<ListingDetail | undefined>): ListingDetail[] =>
  items.filter((item): item is ListingDetail => item !== undefined);
