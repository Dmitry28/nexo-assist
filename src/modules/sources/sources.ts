import { ghb } from './ghb/ghb.source';
import { gridom } from './gridom/gridom.source';
import { grodnorik } from './grodnorik/grodnorik.source';
import { gsz } from './gsz/gsz.source';
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
] as const;

/**
 * How a reader names a source: its site. The id is a storage key («kufar-travel» names no site);
 * an id no longer registered prints as itself.
 */
export const siteName = (id: string): string => SOURCES.find((s) => s.id === id)?.host ?? id;

/** The adapters the app runs — one per source, built from SOURCES. */
export const ADAPTERS = createSourceAdapters(SOURCES);
