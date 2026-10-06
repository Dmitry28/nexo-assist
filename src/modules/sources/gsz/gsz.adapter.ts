import { Injectable, Logger } from '@nestjs/common';

import { matchesHost, withParam } from '@/common/url';

import { paginate } from '../scraping/paginate';
import type { FetchResult, SourceAdapter, SourceId } from '../source-adapter';

import { HOST, SEARCH_PATH, extractPage } from './gsz.parser';

/** gsz.gov.by source adapter — vacancies, newest-published first, up to the window. */
@Injectable()
export class GszAdapter implements SourceAdapter {
  readonly id: SourceId = 'gsz';
  readonly volatileParams = ['sort_by', 'paginate_by', 'page'];
  private readonly logger = new Logger(GszAdapter.name);

  // The search page only: a vacancy or a cabinet link would fail every poll as "site down".
  matches(url: string): boolean {
    return matchesHost({ url, host: HOST }) && new URL(url).pathname.startsWith(SEARCH_PATH);
  }

  async fetch(url: string): Promise<FetchResult> {
    // NOTE: newest-first and the largest page the site offers (50), so the window is 3 requests.
    // TLS: the prototype needed its own CA bundle — see PRODUCT_PLAN.md § Фаза 5.6, gsz.
    const base = withParam(
      withParam(url, 'sort_by', 'sort_published_at_desc'),
      'paginate_by',
      '50',
    );
    const now = new Date();
    // TODO [M]: no proxy — not measured from the Hetzner host; curl gsz.gov.by from it after deploy.
    return paginate({
      firstUrl: withParam(base, 'page', '1'),
      host: HOST,
      parsePage: (html, page) => {
        const { listings, hasMore } = extractPage(html, page, now);
        return { listings, nextUrl: hasMore ? withParam(base, 'page', String(page + 1)) : null };
      },
      logger: this.logger,
    });
  }
}
