import { Logger } from '@nestjs/common';

import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { PAID_SCRAPER_ORIGIN } from '@/common/paid-scrapers';

import { PaidRungsUnavailableError, SourceUnavailableError } from '../../source-adapter';
import type * as SourceAdapterModule from '../../source-adapter';
import { freeProxyRung } from '../free-proxies';
import { fetchProtected } from '../ladder';
import type { Protection } from '../ladder';
import { pageCredits, resetSpentProviders } from '../providers';

const fetchMock = undiciFetchMock();

// The free-proxy rung has its own spec (free-proxies.spec.ts); here it never finds a proxy, without
// a request — the calls below are the target's and the paid services' alone.
jest.mock('../free-proxies', () => {
  const { SourceUnavailableError: Unavailable } =
    jest.requireActual<typeof SourceAdapterModule>('../../source-adapter');
  return {
    freeProxyRung: jest.fn(() => ({
      name: 'free-proxy',
      run: () => Promise.reject(new Unavailable('no free proxy listed')),
    })),
  };
});

const REAL = '<html><select id="sorter"></select></html>';
const CHALLENGE = '<html>Just a moment…</html>';
// A geo-fenced site: ZenRows, Scrape.do, ScrapeOps, ScrapFly serve it.
const protection: Protection = { usable: (html) => html.includes('id="sorter"'), country: 'by' };
// A site without a country: only ScrapingAnt and ScraperAPI serve it.
const noCountry: Protection = { usable: protection.usable };
const page = (body: string, status = 200): Response => new Response(body, { status });
const get = (asked = protection) =>
  fetchProtected({ url: 'https://x.by/a', host: 'x.by', protection: asked });
/** Keys for the two providers of sites without a country (afterEach drops them). */
const withSpareKeys = (): void => {
  process.env.SCRAPINGANT_API_KEY = 'sa-secret';
  process.env.SCRAPER_API_KEY = 'sapi-secret';
};
// A provider's balance, asked after a paid page for the log — not a rung.
const BALANCE = /\/(v2\/usage|account|info|v1\/subscriptions\/self\/details)(\?|$)/;
/** The provider each call went to, by host — the plain rung is the target itself. */
const calledHosts = (): string[] =>
  fetchMock.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => !BALANCE.test(url.pathname + url.search))
    .map((url) => url.host);

describe('fetchProtected', () => {
  beforeEach(() => {
    resetSpentProviders();
    delete process.env.SCRAPE_PROXY_URL;
    process.env.ZENROWS_API_KEY = 'zr-secret';
    process.env.SCRAPE_DO_API_KEY = 'sd-secret';
  });
  afterEach(() => {
    delete process.env.ZENROWS_API_KEY;
    delete process.env.SCRAPE_DO_API_KEY;
    delete process.env.SCRAPINGANT_API_KEY;
    delete process.env.SCRAPER_API_KEY;
  });

  it('stops at the first free rung that returns the real page — nothing paid', async () => {
    fetchMock.mockResolvedValue(page(REAL));

    await expect(get()).resolves.toBe(REAL);
    expect(calledHosts()).toEqual(['x.by']);
  });

  it('climbs past a challenge page and an error status to the paid rungs, in order', async () => {
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain: a 200 that is not the page
      .mockResolvedValueOnce(page('', 500)) // zenrows: failed
      .mockResolvedValueOnce(page(REAL)); // scrape.do

    await expect(get()).resolves.toBe(REAL);
    expect(calledHosts()).toEqual(['x.by', 'api.zenrows.com', 'api.scrape.do']);
    // The anti-bot tier goes to the provider; no render unless the source asks.
    const zenrows = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(zenrows.get('premium_proxy')).toBe('true');
    expect(zenrows.has('js_render')).toBe(false);
  });

  it('asks the provider for the site’s country and a render', async () => {
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page(REAL)); // zenrows

    await expect(get({ ...protection, renderWaitMs: 8000 })).resolves.toBe(REAL);

    // Free proxies of the country first: the paid rung is reached only past them.
    expect(freeProxyRung).toHaveBeenCalledWith(
      'https://x.by/a',
      'x.by',
      protection.usable,
      'by',
      undefined,
    );
    expect(calledHosts()).toEqual(['x.by', 'api.zenrows.com']);
    const zenrows = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(zenrows.get('proxy_country')).toBe('by');
    expect(zenrows.get('js_render')).toBe('true');
    expect(zenrows.get('wait')).toBe('8000');
  });

  it('says why every rung failed — and never prints a key', async () => {
    fetchMock
      .mockResolvedValueOnce(page('', 403))
      .mockRejectedValueOnce(
        new Error('connect ECONNREFUSED https://api.zenrows.com/?apikey=zr-secret'),
      )
      .mockResolvedValueOnce(page(CHALLENGE));

    const err = await get().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SourceUnavailableError);
    const { message, cause } = err as Error;
    expect(message).toContain('plain: HTTP 403');
    expect(message).toContain('zenrows: request failed');
    expect(message).toContain('scrapedo: not the page');
    expect(JSON.stringify({ message, cause, stack: (err as Error).stack })).not.toMatch(/secret/);
  });

  // Their URLs carry the key: OTel must skip them and Sentry's breadcrumbs scrub them.
  it('reaches every paid service at an origin the telemetry knows to hide', async () => {
    withSpareKeys();
    process.env.SCRAPEOPS_API_KEY = 'so-secret';
    process.env.SCRAPFLY_API_KEY = 'sf-secret';
    fetchMock.mockImplementation(() => Promise.resolve(page('', 500)));

    await get().catch(() => undefined);
    await get(noCountry).catch(() => undefined);

    const paid = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => !url.startsWith('https://x.by'));
    expect(paid).toHaveLength(6);
    for (const url of paid) expect(url).toMatch(PAID_SCRAPER_ORIGIN);
    delete process.env.SCRAPEOPS_API_KEY;
    delete process.env.SCRAPFLY_API_KEY;
  });

  it('reads the page out of ScrapFly’s JSON, the last rung', async () => {
    delete process.env.ZENROWS_API_KEY;
    delete process.env.SCRAPE_DO_API_KEY;
    process.env.SCRAPFLY_API_KEY = 'sf-secret';
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE))
      .mockResolvedValueOnce(page(JSON.stringify({ result: { content: REAL, status_code: 200 } })));

    await expect(get()).resolves.toBe(REAL);
    expect(calledHosts()).toEqual(['x.by', 'api.scrapfly.io']);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('asp')).toBe('true');
    delete process.env.SCRAPFLY_API_KEY;
  });

  it('asks ScrapingAnt, then ScraperAPI, for a site without a country', async () => {
    withSpareKeys();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('', 500)) // scrapingant
      .mockResolvedValueOnce(page(REAL)); // scraperapi

    await expect(get({ ...noCountry, renderWaitMs: 10_000 })).resolves.toBe(REAL);

    expect(calledHosts()).toEqual(['x.by', 'api.scrapingant.com', 'api.scraperapi.com']);
    const [antUrl, antInit] = fetchMock.mock.calls[1] as [string, { headers?: object }];
    // ScrapingAnt's key travels in a header, never in the URL.
    expect(antUrl).not.toContain('sa-secret');
    expect(antInit.headers).toEqual({ 'x-api-key': 'sa-secret' });
    const ant = new URL(antUrl).searchParams;
    expect(ant.get('browser')).toBe('true');
    expect(Buffer.from(ant.get('js_snippet') ?? '', 'base64').toString()).toContain('10000');
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('render')).toBe('true');
  });

  it('carries a POST up the ladder — the body and the site headers, each provider its way', async () => {
    withSpareKeys();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('', 500)) // scrapingant
      .mockResolvedValueOnce(page(REAL)); // scraperapi
    const post = { body: '{"q":1}', headers: { Origin: 'https://x.by' } };

    await expect(
      fetchProtected({ url: 'https://x.by/a', host: 'x.by', protection: noCountry, post }),
    ).resolves.toBe(REAL);

    type Init = { method?: string; body?: string; headers?: Record<string, string> };
    const [plain, ant, sapi] = fetchMock.mock.calls as [string, Init][];
    expect(plain[1]).toMatchObject({ method: 'POST', body: '{"q":1}' });
    expect(ant[1]).toMatchObject({ method: 'POST', body: '{"q":1}' });
    expect(ant[1].headers).toMatchObject({
      'ant-Origin': 'https://x.by',
      'x-api-key': 'sa-secret',
    });
    expect(new URL(String(sapi[0])).searchParams.get('keep_headers')).toBe('true');
    expect(sapi[1].headers).toMatchObject({ Origin: 'https://x.by' });
  });

  // Every free way first (owner): Copart has no country of its own, yet US proxies come before
  // the paid rungs — and its paid pool stays the global one.
  it('tries free proxies of `freeProxyCountry` before the paid rungs, keeping the global pool', async () => {
    withSpareKeys();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page(REAL)); // scrapingant
    const post = { body: '{}', headers: {} };

    await fetchProtected({
      url: 'https://x.by/a',
      host: 'x.by',
      protection: { ...noCountry, freeProxyCountry: 'us' },
      post,
    });

    expect(freeProxyRung).toHaveBeenCalledWith(
      'https://x.by/a',
      'x.by',
      noCountry.usable,
      'us',
      post,
    );
    expect(calledHosts()).toEqual(['x.by', 'api.scrapingant.com']);
  });

  // The balance URL carries the key (ScraperAPI's `api_key`): its failure must never print it,
  // nor cost the page.
  it('logs what a paid page cost and what is left, and survives a failing balance', async () => {
    const logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    withSpareKeys();
    delete process.env.SCRAPINGANT_API_KEY;
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(new Response(REAL, { headers: { 'sa-credit-cost': '1' } })) // scraperapi
      .mockRejectedValueOnce(
        new Error('connect failed https://api.scraperapi.com/account?api_key=sapi-secret'),
      );

    await expect(get(noCountry)).resolves.toBe(REAL);
    await new Promise((resolve) => setImmediate(resolve)); // the balance line is not awaited

    const lines = logs.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(`scraperapi: ${REAL.length} chars, cost 1, left ?`);
    expect(lines.join('\n')).not.toMatch(/secret/);
  });

  it('asks no provider that has not been measured carrying a POST', async () => {
    process.env.SCRAPEOPS_API_KEY = 'so-secret';
    fetchMock.mockImplementation(() => Promise.resolve(page('', 500)));
    const post = { body: '{}', headers: {} };

    await fetchProtected({ url: 'https://x.by/a', host: 'x.by', protection, post }).catch(
      () => undefined,
    );

    // No ScrapeOps — ZenRows and Scrape.do were measured carrying it.
    expect(calledHosts()).toEqual(['x.by', 'api.zenrows.com', 'api.scrape.do']);
    delete process.env.SCRAPEOPS_API_KEY;
  });

  // Measured: a site's own block reaches us as ScraperAPI 500 / ScrapingAnt 423, a refused key as
  // 401 / 403 — only the latter benches the provider.
  it('benches ScrapingAnt for a refused key, not ScraperAPI for a blocked site', async () => {
    withSpareKeys();
    fetchMock.mockImplementation(() => Promise.resolve(page(CHALLENGE)));
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('', 403)) // scrapingant: key refused
      .mockResolvedValueOnce(page('', 500)); // scraperapi: the site blocked it
    await get(noCountry).catch(() => undefined);

    fetchMock.mockClear();
    await get(noCountry).catch(() => undefined);

    expect(calledHosts().slice(0, 2)).toEqual(['x.by', 'api.scraperapi.com']);
  });

  // Each pool is its own free tiers and its own budget (poolOf): a site never spends the other's.
  it('keeps the pools apart: a geo site never reaches the global two, nor the reverse', async () => {
    withSpareKeys();
    fetchMock.mockImplementation(() => Promise.resolve(page('', 500)));

    await get().catch(() => undefined);
    const geo = calledHosts();
    fetchMock.mockClear();
    await get(noCountry).catch(() => undefined);

    expect(geo).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/scrapingant|scraperapi/)]),
    );
    expect(calledHosts()).toEqual(['x.by', 'api.scrapingant.com', 'api.scraperapi.com']);
    // Only the geo site had free proxies of its country to try.
    expect(freeProxyRung).toHaveBeenCalledTimes(1);
  });

  it('skips a provider without a key, saying so', async () => {
    delete process.env.ZENROWS_API_KEY;
    fetchMock.mockResolvedValueOnce(page(CHALLENGE)).mockResolvedValueOnce(page(REAL));

    await expect(get()).resolves.toBe(REAL);
    expect(calledHosts()).toEqual(['x.by', 'api.scrape.do']);
  });

  // Every later poll of the run would otherwise pay a round trip to hear «spent» again.
  it('stops asking a provider that said it is spent', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(page(CHALLENGE)));
    fetchMock.mockResolvedValueOnce(page(CHALLENGE)).mockResolvedValueOnce(page('', 402));
    await get().catch(() => undefined);

    fetchMock.mockClear();
    const err = (await get().catch((e: unknown) => e)) as Error;

    expect(calledHosts()).toEqual(['x.by', 'api.scrape.do']);
    expect(err.message).toContain('zenrows: spent or refused earlier');
  });

  it('retries a failed bypass (ZenRows 422) once on the same provider', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE))
      .mockResolvedValueOnce(page('', 422))
      .mockResolvedValueOnce(page(REAL));

    const run = get();
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(run).resolves.toBe(REAL);
    expect(calledHosts()).toEqual(['x.by', 'api.zenrows.com', 'api.zenrows.com']);
    jest.useRealTimers();
  });

  // Ours to fix, not the link's: the scheduler must not count it against the subscription.
  it('says so when no paid service could even be asked', async () => {
    delete process.env.ZENROWS_API_KEY;
    delete process.env.SCRAPE_DO_API_KEY;
    fetchMock.mockResolvedValueOnce(page(CHALLENGE));

    await expect(get()).rejects.toBeInstanceOf(PaidRungsUnavailableError);
  });

  it('is an ordinary outage once a paid service was asked and failed', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(page('', 500)));

    const err = await get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err).not.toBeInstanceOf(PaidRungsUnavailableError);
  });

  it('retries the ZenRows concurrency limit instead of benching it', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE))
      .mockResolvedValueOnce(page('', 429))
      .mockResolvedValueOnce(page(REAL));

    const run = get();
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(run).resolves.toBe(REAL);
    jest.useRealTimers();
  });

  it('has no direct rung for a source that must go through the proxy', async () => {
    process.env.SCRAPE_PROXY_URL = 'http://proxy.local:3128';
    fetchMock.mockResolvedValueOnce(page(REAL));

    await fetchProtected({ url: 'https://x.by/a', host: 'x.by', useProxy: true, protection });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { dispatcher?: unknown }];
    expect(init.dispatcher).toBeDefined();
  });

  it('throws a redirect off the host as is — that is no reason to pay', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { location: 'https://evil.com/' } }),
    );

    await expect(get()).rejects.toThrow('Redirected off');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('goes through our proxy before paying, when one is configured', async () => {
    process.env.SCRAPE_PROXY_URL = 'http://proxy.local:3128';
    fetchMock.mockResolvedValueOnce(page(CHALLENGE)).mockResolvedValueOnce(page(REAL));

    await expect(get()).resolves.toBe(REAL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, { dispatcher?: unknown }];
    expect(init.dispatcher).toBeDefined();
  });
});

// What a page costs is what the daily budget is sized by (subscriptions.service.ts).
describe('pageCredits', () => {
  const usable = (): boolean => true;
  it.each<[string, Protection, number]>([
    ['a geo site', { usable, country: 'by' }, 10],
    ['a rendered geo site', { usable, country: 'by', renderWaitMs: 10_000 }, 25],
    // ScrapingAnt: its browser 10, a plain request 1 (its `ant-credits-cost`, measured).
    ['a rendered site without a country', { usable, renderWaitMs: 10_000 }, 10],
    ['a plain site without a country', { usable }, 1],
  ])('%s costs %p', (_label, asked, credits) => {
    expect(pageCredits(asked)).toBe(credits);
  });
});
