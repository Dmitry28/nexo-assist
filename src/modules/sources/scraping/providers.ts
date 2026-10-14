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
  /** Request headers — where a provider takes its key, the key stays out of the URL. */
  headers?(key: string): Record<string, string>;
  /**
   * Whether its free tier can put the request in a given country. One that cannot is left out for
   * a geo-fenced site: it would only hear «blocked».
   */
  targetsCountry: boolean;
  /** Statuses that mean «nothing more from this provider now» — spent or a refused key. */
  spent: ReadonlySet<number>;
  /** Statuses worth one more try on the same provider. */
  retry: ReadonlySet<number>;
  /** Header with what the call actually cost, when the provider reports it. */
  costHeader?: string;
  /** The longest one call may take — what is left of the ladder's budget goes to the next. */
  maxMs: number;
  /** Not worth asking with less time than this left (a provider that retries on its side). */
  minMs?: number;
}

// A rendered page with its settle time and the provider's own bypass fit in a minute.
const PROVIDER_MAX_MS = 60_000;
// The two that serve only sites without a country answered bid.cars in 13-14 s; half a minute
// each keeps a stall from eating the minute ZenRows and Scrape.do need after them.
const SPARE_MAX_MS = 30_000;

/**
 * The paid rungs, in order of their free tiers (PRODUCT_PLAN.md § «Платная ступень»). Rendering is
 * asked for only when the source needs it — it is billed on top, and forcing it burned most of a
 * month's tier in the prototype.
 */
const PROVIDERS: readonly Provider[] = [
  {
    // 10000 credits a month — the largest tier — but no Belarus and detected on idriver (423), so
    // first only for sites without a country (bid.cars: 50 lots, 14 s).
    name: 'scrapingant',
    keyVar: 'SCRAPINGANT_API_KEY',
    requestUrl: (target, _key, { renderWaitMs }) => {
      const params = new URLSearchParams({
        url: target,
        browser: String(renderWaitMs !== undefined),
      });
      // No wait parameter, but an awaited js_snippet is one: without it bid.cars arrives as the
      // shell with no cards (prototype, 25.09 and 27.09).
      if (renderWaitMs !== undefined) {
        const snippet = `await new Promise((r) => setTimeout(r, ${renderWaitMs}));`;
        params.set('js_snippet', Buffer.from(snippet).toString('base64'));
      }
      return `https://api.scrapingant.com/v2/general?${params.toString()}`;
    },
    headers: (key) => ({ 'x-api-key': key }),
    targetsCountry: false,
    // 403 a wrong key (measured) or the month's credits gone (its docs); 409 its concurrency limit
    // (docs) — it clears. A site's own 403/429 arrives as 423 «detected by the site» (measured
    // 2026-10-15), never as a bench: asking again cost the prototype another ~22 s for the same.
    spent: new Set([401, 403]),
    retry: new Set([409]),
    maxMs: SPARE_MAX_MS,
  },
  {
    // 1000 credits a month; the free tier has no premium pool, so no country (a 403 «plan does
    // not allow premium»). Its standard pool with render read bid.cars: 50 lots, 13 s.
    name: 'scraperapi',
    keyVar: 'SCRAPER_API_KEY',
    requestUrl: (target, key, { renderWaitMs }) => {
      const params = new URLSearchParams({ api_key: key, url: target });
      // No wait parameter; its render waits for the page to settle by itself (measured enough).
      if (renderWaitMs !== undefined) params.set('render', 'true');
      return `https://api.scraperapi.com/?${params.toString()}`;
    },
    targetsCountry: false,
    // 401 a bad key (measured), 403 the month's credits gone (docs; no premium is ever asked), 429
    // concurrency. A site's own 401/403/429 arrives as 500 after its retries (measured 2026-10-15),
    // so a blocked site never benches it.
    spent: new Set([401, 403]),
    retry: new Set([429]),
    maxMs: SPARE_MAX_MS,
  },
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
    targetsCountry: true,
    // 401 a bad key, 402 the month's credits gone. 429 is the concurrency limit — it clears.
    spent: new Set([401, 402]),
    retry: new Set([422, 429]),
    maxMs: PROVIDER_MAX_MS,
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
    targetsCountry: true,
    // 401 a bad token or the month's requests gone (measured 2026-10-14: «Monthly request limit
    // exceeded»), 429 the same per the prototype.
    // NOTE: Scrape.do passes the target's own status through, so a site answering 401/429 benches
    // it for a day too — the prototype ran with that; split on its target-status header if it bites.
    spent: new Set([401, 429]),
    retry: new Set(),
    // It switches the residential tier and rendering on by itself where a domain needs them, so
    // the header is the only honest account of the cost.
    costHeader: 'scrape.do-request-cost',
    maxMs: PROVIDER_MAX_MS,
  },
  {
    // 1000 credits a month, billed only for a 200/404 — a failed bypass costs nothing, which suits
    // the last rung.
    name: 'scrapeops',
    keyVar: 'SCRAPEOPS_API_KEY',
    requestUrl: (target, key, { country, renderWaitMs }) => {
      // The residential pool: the standard one has no Belarus, and Cloudflare lets only it through.
      const params = new URLSearchParams({ api_key: key, url: target, residential: 'true' });
      if (country) params.set('country', country);
      if (renderWaitMs !== undefined) {
        params.set('render_js', 'true');
        params.set('wait', String(renderWaitMs));
      }
      return `https://proxy.scrapeops.io/v1/?${params.toString()}`;
    },
    targetsCountry: true,
    // 401 credits gone, 403 a bad key. 429 is its one-at-a-time limit — polls never overlap (one
    // polling slot), so it does not come up; 500 is it giving up after its own retries.
    spent: new Set([401, 403]),
    retry: new Set(),
    // It retries the target on its side for up to 2 minutes before answering.
    maxMs: 150_000,
    minMs: 130_000,
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

/**
 * One paid rung per provider that can serve the site, in order — a rung without its key fails at
 * once, saying so.
 */
export const paidRungs = (
  target: string,
  protection: Protection,
): { name: string; run: (timeoutMs: number) => Promise<string> }[] =>
  PROVIDERS.filter((provider) => protection.country === undefined || provider.targetsCountry).map(
    (provider) => ({
      name: provider.name,
      run: (timeoutMs) => scrape(provider, target, protection, timeoutMs),
    }),
  );

async function scrape(
  provider: Provider,
  target: string,
  protection: Protection,
  timeoutMs: number,
): Promise<string> {
  const key = process.env[provider.keyVar];
  if (!key) throw new ProviderUnavailableError('no key');
  // Not asked at all — like a missing key (PaidRungsUnavailableError counts on that).
  if (timeoutMs < (provider.minMs ?? 0)) throw new ProviderUnavailableError('not enough time left');
  if ((spentUntil.get(provider.name) ?? 0) > Date.now()) {
    throw new ProviderUnavailableError('spent or refused earlier — skipped for a day');
  }
  const deadline = Date.now() + Math.min(timeoutMs, provider.maxMs);
  for (let attempt = 0; ; attempt++) {
    const status = await call(
      provider,
      provider.requestUrl(target, key, protection),
      provider.headers?.(key),
      deadline,
    );
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
async function call(
  provider: Provider,
  url: string,
  headers: Record<string, string> | undefined,
  deadline: number,
): Promise<string | number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    const res = await fetch(url, { headers, signal: controller.signal }).catch(() => {
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
