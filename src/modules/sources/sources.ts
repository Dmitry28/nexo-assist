import { avBy } from './av-by/av-by.source';
import { bamper } from './bamper/bamper.source';
import { bidCars } from './bid-cars/bid-cars.source';
import { copart } from './copart/copart.source';
import { gcn } from './gcn/gcn.source';
import { ghb } from './ghb/ghb.source';
import { gridom } from './gridom/gridom.source';
import { grodnorik } from './grodnorik/grodnorik.source';
import { gsz } from './gsz/gsz.source';
import { iaai } from './iaai/iaai.source';
import { idriver } from './idriver/idriver.source';
import { kufar } from './kufar/kufar.source';
import { kufarTravel } from './kufar-travel/kufar-travel.source';
import { prometr } from './prometr/prometr.source';
import { rabota } from './rabota/rabota.source';
import { realt } from './realt/realt.source';
import { createSourceAdapters } from './source-definition';

/** Every source — register a new one here; this line is the only edit outside its folder. */
export const SOURCES = [
  kufar,
  kufarTravel,
  realt,
  gsz,
  rabota,
  ghb,
  grodnorik,
  prometr,
  gridom,
  gcn,
  idriver,
  avBy,
  bamper,
  bidCars,
  copart,
  iaai,
] as const;

/**
 * How a reader names a source: its site. The id is a storage key («kufar-travel» names no site);
 * an id no longer registered prints as itself.
 */
export const siteName = (id: string): string => SOURCES.find((s) => s.id === id)?.host ?? id;

/**
 * The single listing a link points at, on a source that watches items — its id and canonical
 * address; undefined for a search (or a source without items). Pure, like `siteName`: the bot's
 * texts and labels need it without the registry.
 */
export function watchedItem(source: string, url: string): { id: string; url: string } | undefined {
  const item = SOURCES.find((s) => s.id === source)?.item;
  // A stored URL that no longer parses is no item — and must not throw into a delivery.
  const found = URL.canParse(url) ? item?.match(url) : undefined;
  return found ? { id: found.id, url: found.url } : undefined;
}

/** The adapters the app runs — one per source, built from SOURCES. */
export const ADAPTERS = createSourceAdapters(SOURCES);
