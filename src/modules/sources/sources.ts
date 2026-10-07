import { gsz } from './gsz/gsz.source';
import { kufar } from './kufar/kufar.source';
import { kufarTravel } from './kufar-travel/kufar-travel.source';
import { rabota } from './rabota/rabota.source';
import { realt } from './realt/realt.source';
import { createSourceAdapters } from './source-definition';

/** Every source — register a new one here; this line is the only edit outside its folder. */
export const SOURCES = [kufar, kufarTravel, realt, gsz, rabota] as const;

/** The adapters the app runs — one per source, built from SOURCES. */
export const ADAPTERS = createSourceAdapters(SOURCES);
