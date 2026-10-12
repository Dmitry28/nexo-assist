import { Logger } from '@nestjs/common';
import { fetch } from 'undici';

import { wait } from '@/common/wait';

import { SourceUnavailableError } from '../source-adapter';

import type { Protection } from './ladder';

// A ceiling, not a guess: a provider is cut by whatever is left of the ladder's budget first.
const MAX_HTML_LENGTH = 5 * 1024 * 1024;
// A provider that said «spent» or «bad key» is not asked again for a day: every later poll of the
// run would otherwise pay a round trip (and ZenRows its retries) to hear the same answer. The
// free tiers renew monthly; a day keeps a renewed or re-keyed provider from waiting long.
const SPENT_FOR_MS = 24 * 60 * 60 * 1000;
// ZenRows' 422 «could not get content» is a failed bypass on their side, documented as retryable
// — the prototype saw the same bamper page 422 four runs and return 690 KB on the fifth.
const BYPASS_RETRY_DELAY_MS = 3_000;

const logger = new Logger('scraping:providers');

/** One managed anti-bot service: how it is asked for a page. */
interface Provider {
  name: string;
  /** Its key's env var — a secret, read where used (see SCRAPE_PROXY_URL in http.ts). */
  keyVar: string;
  /**
   * The request URL. Carries the key: never put it in an error or a log line; Sentry's breadcrumbs
   * and OTel's spans are scrubbed for it (common/redact.ts, tracing.ts).
   */
  requestUrl(target: string, key: string, protection: Protection): string;
  /** Statuses that mean «nothing more from this provider now» — spent or a refused key. */
  spent: ReadonlySet<number>;
  /** Statuses worth one more try on the same provider. */
  retry: ReadonlySet<number>;
  /** Header with what the call actually cost, when the provider reports it. */
  costHeader?: string;
}

/**
 * The paid rungs, in order. ZenRows first: 5000 free credits a month against Scrape.do's 1000, at
 * the same 10 per protected page (25 with rendering). Rendering is asked for only when the source
 * needs it — it is billed on top, and forcing it burned most of a month's tier in the prototype.
 */
const PROVIDERS: readonly Provider[] = [
  {
    name: 'zenrows',
    keyVar: 'ZENROWS_API_KEY',
    requestUrl: (target, key, { country, renderWaitMs }) => {
      // premium_proxy is the residential tier — what clears Cloudflare and a geo-block.
      const params = new URLSearchParams({ apikey: key, url: target, premium_proxy: 'true' });
      if (country) params.set('proxy_country', country);
      if (renderWaitMs !== undefined) {
        params.set('js_render', 'true');
        // Without the wait a page that fills itself after load arrives empty (bid.cars: 0 lots).
        params.set('wait', String(renderWaitMs));
      }
      return `https://api.zenrows.com/v1/?${params.toString()}`;
    },
    // 401 a bad key, 402 the month's credits gone. 429 is the concurrency limit — it clears.
    spent: new Set([401, 402]),
    retry: new Set([422, 429]),
  },
  {
    name: 'scrapedo',
    keyVar: 'SCRAPE_DO_API_KEY',
    requestUrl: (target, key, { country, renderWaitMs }) => {
      const params = new URLSearchParams({ token: key, url: target, super: 'true' });
      if (country) params.set('geoCode', country);
      if (renderWaitMs !== undefined) {
        params.set('render', 'true');
        params.set('customWait', String(renderWaitMs));
      }
      return `https://api.scrape.do/?${params.toString()}`;
    },
    // 401 a bad token, 429 the month's credits gone (measured by the prototype).
    // NOTE: Scrape.do passes the target's own status through, so a site answering 401/429 benches
    // it for a day too — the prototype ran with that; split on its target-status header if it bites.
    spent: new Set([401, 429]),
    retry: new Set(),
    // It switches the residential tier and rendering on by itself where a domain needs them, so
    // the header is the only honest account of the cost.
    costHeader: 'scrape.do-request-cost',
  },
];

/**
 * A paid rung that was not even tried — no key, or benched as spent. Lets the ladder tell «the
 * site would not answer» from «we had nothing to ask it with» (PaidRungsUnavailableError).
 */
export class ProviderUnavailableError extends SourceUnavailableError {
  override readonly name = 'ProviderUnavailableError';
}

const spentUntil = new Map<string, number>();

/** For specs: forget which providers were marked spent. */
export const resetSpentProviders = (): void => spentUntil.clear();

/** One paid rung per provider, in order — a rung without its key fails at once, saying so. */
export const paidRungs = (
  target: string,
  protection: Protection,
): { name: string; run: (timeoutMs: number) => Promise<string> }[] =>
  PROVIDERS.map((provider) => ({
    name: provider.name,
    run: (timeoutMs) => scrape(provider, target, protection, timeoutMs),
  }));

async function scrape(
  provider: Provider,
  target: string,
  protection: Protection,
  timeoutMs: number,
): Promise<string> {
  const key = process.env[provider.keyVar];
  if (!key) throw new ProviderUnavailableError('no key');
  if ((spentUntil.get(provider.name) ?? 0) > Date.now()) {
    throw new ProviderUnavailableError('spent or refused earlier — skipped for a day');
  }
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const status = await call(provider, provider.requestUrl(target, key, protection), deadline);
    if (typeof status === 'string') return status;
    if (provider.spent.has(status)) {
      spentUntil.set(provider.name, Date.now() + SPENT_FOR_MS);
      throw new ProviderUnavailableError(`HTTP ${status} — spent or key refused`);
    }
    const again = provider.retry.has(status) && attempt === 0;
    if (!again || deadline - Date.now() <= BYPASS_RETRY_DELAY_MS) {
      throw new SourceUnavailableError(`HTTP ${status}`);
    }
    await wait(BYPASS_RETRY_DELAY_MS);
  }
}

/** One request: the body, or the status when it was not a 2xx. */
async function call(provider: Provider, url: string, deadline: number): Promise<string | number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    const res = await fetch(url, { signal: controller.signal }).catch(() => {
      // A fresh error without `cause`: undici's carries the request URL, and with it the key.
      throw new SourceUnavailableError(controller.signal.aborted ? 'timed out' : 'request failed');
    });
    if (!res.ok) return res.status;
    const html = await res.text().catch(() => {
      throw new SourceUnavailableError('body failed');
    });
    if (html.length === 0) throw new SourceUnavailableError('empty body');
    if (html.length > MAX_HTML_LENGTH) throw new SourceUnavailableError('response too large');
    const cost = provider.costHeader && res.headers.get(provider.costHeader);
    logger.log(`${provider.name}: ${html.length} chars${cost ? `, cost ${cost}` : ''}`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}
