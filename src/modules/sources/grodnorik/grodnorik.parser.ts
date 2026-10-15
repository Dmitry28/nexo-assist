import { parse } from 'node-html-parser';

import { detail, listingDetails } from '../listing-details';
import { elementText, linkPath } from '../scraping/html';
import { ruDate } from '../scraping/ru-date';
import { SourceUnavailableError } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SearchPage } from '../source-definition';

/** grodnorik.gov.by — the Grodno district executive committee. */
export const HOST = 'grodnorik.gov.by';
/** The auctions page — notices of land and property auctions, as PDF/DOC files. */
export const SEARCH_PATH = '/ru/auctions/';

// Notices are files under /uploads/files/materialy/ (measured 2026-10-07: …/aukciony/ and …/OBR/).
const NOTICE_PATH = /^\/uploads\/files\/materialy\/.+\.(pdf|docx?)$/i;

/**
 * The notices on the auctions page, one listing per file. The same file is often linked twice
 * (one anchor holds the title, a sibling wraps a separator), so notices are keyed by path — the
 * site mixes http/https, which must not re-announce the archive — and the longest title wins.
 *
 * NOTE: the page is roughly newest-on-top (an older notice was seen pinned first) and grows by
 * ~40 a year; the window keeps the top 150, right while new notices are added at the top.
 * A removed notice is just archived — nothing to report. No notices at all is a layout change.
 */
export function parsePage(html: string): Omit<SearchPage<never>, 'next'> {
  const titles = new Map<string, string>();
  for (const anchor of parse(html).querySelectorAll('.inner_text a')) {
    const raw = linkPath(anchor.getAttribute('href'), HOST);
    const path = raw === undefined ? undefined : safeDecode(raw);
    if (path === undefined || !NOTICE_PATH.test(path)) continue;
    const title = elementText(anchor) ?? '';
    if (!titles.has(path) || title.length > (titles.get(path)?.length ?? 0))
      titles.set(path, title);
  }
  if (titles.size === 0)
    throw new SourceUnavailableError('grodnorik: no notices — page layout changed?');
  return { listings: [...titles].map(([path, title]) => toListing(path, title)) };
}

function safeDecode(path: string): string | undefined {
  try {
    return decodeURI(path);
  } catch {
    return undefined;
  }
}

function toListing(path: string, rawTitle: string): Listing {
  // An anchor with no text (a wrapped separator) still names its notice by the file name.
  const title =
    rawTitle || (path.split('/').pop() ?? path).replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ');
  return {
    externalId: path,
    link: encodeURI(`https://${HOST}${path}`),
    title,
    // An auction has a starting price in the notice, not on the page — never «Договорная».
    priceText: 'цена — в извещении',
    listTime: '',
    images: [],
    // Best effort: the title's date, else a dd-mm-yyyy in the file name.
    details: listingDetails(detail('Аукцион', ruDate(title) ?? ruDate(path.replace(/-/g, '.')))),
  };
}
