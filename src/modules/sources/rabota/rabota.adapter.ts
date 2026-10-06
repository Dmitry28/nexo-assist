import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { FetchResult, SourceAdapter, SourceId } from '../source-adapter';

import { HOST, SEARCH_PATH, extractPage } from './rabota.parser';

/** rabota.by source adapter — vacancies, newest-published first, up to the window. */
@Injectable()
export class RabotaAdapter implements SourceAdapter {
  readonly id: SourceId = 'rabota';
  // The last three are hh's own per-visit params, carried by its pager links and pasted URLs —
  // they name no search, and the duplicate check must not see them.
  readonly volatileParams = [
    'order_by',
    'items_on_page',
    'page',
    'search_session_id',
    'hhtmFrom',
    'hhtmFromLabel',
  ];
  private readonly logger = new Logger(RabotaAdapter.name);

  // The results page only: `/search/vacancy/advanced` is the search form, which has no results
  // and would fail every poll as "site down".
  matches(url: string): boolean {
    return (
      matchesHost({ url, host: HOST }) && new URL(url).pathname.replace(/\/$/, '') === SEARCH_PATH
    );
  }

  async fetch(url: string): Promise<FetchResult> {
    // NOTE: hh sorts by relevance unless told otherwise; 100 a page (the most it serves) makes the
    // window two requests, and a pasted smaller size cannot shrink it. Pages are 0-based.
    const base = withParam(withParam(url, 'order_by', 'publication_time'), 'items_on_page', '100');
    // TODO [M]: no proxy — not measured from the Hetzner host; the prototype saw plain requests
    // fail there. curl rabota.by from it and set useProxy from the answer.
    return paginate({
      firstUrl: withParam(base, 'page', '0'),
      host: HOST,
      // Our page counter is 1-based, hh's 0-based: our page N is its N-1, so the next is N.
      parsePage: (html, page) => {
        const { listings, hasMore } = extractPage(html);
        return { listings, nextUrl: hasMore ? withParam(base, 'page', String(page)) : null };
      },
      logger: this.logger,
    });
  }
}
