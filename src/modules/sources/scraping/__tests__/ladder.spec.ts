import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { PAID_SCRAPER_ORIGIN } from '@/common/paid-scrapers';

import { PaidRungsUnavailableError, SourceUnavailableError } from '../../source-adapter';
import { resetFreeProxies } from '../free-proxies';
import { fetchProtected } from '../ladder';
import type { Protection } from '../ladder';
import { resetSpentProviders } from '../providers';

const fetchMock = undiciFetchMock();

const REAL = '<html><select id="sorter"></select></html>';
const CHALLENGE = '<html>Just a moment…</html>';
// No country: the free-proxy rung has its own spec (free-proxies.spec.ts).
const protection: Protection = { usable: (html) => html.includes('id="sorter"') };
const page = (body: string, status = 200): Response => new Response(body, { status });
const get = (asked = protection) =>
  fetchProtected({ url: 'https://x.by/a', host: 'x.by', protection: asked });
/** Keys for the two providers that serve only sites without a country (afterEach drops them). */
const withSpareKeys = (): void => {
  process.env.SCRAPINGANT_API_KEY = 'sa-secret';
  process.env.SCRAPER_API_KEY = 'sapi-secret';
};
/** The provider each call went to, by host — the plain rung is the target itself. */
const calledHosts = (): string[] => fetchMock.mock.calls.map(([url]) => new URL(String(url)).host);

describe('fetchProtected', () => {
  beforeEach(() => {
    resetSpentProviders();
    resetFreeProxies();
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

  it('tries free proxies of the country, then asks the provider for that country and a render', async () => {
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('')) // the free-proxy lists: empty today
      .mockResolvedValueOnce(page('{"data":[]}'))
      .mockResolvedValueOnce(page(REAL)); // zenrows

    await fetchProtected({
      url: 'https://x.by/a',
      host: 'x.by',
      protection: { ...protection, country: 'by', renderWaitMs: 8000 },
    });

    expect(calledHosts()).toEqual([
      'x.by',
      'raw.githubusercontent.com',
      'proxylist.geonode.com',
      'api.zenrows.com',
    ]);
    const zenrows = new URL(String(fetchMock.mock.calls[3][0])).searchParams;
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
    fetchMock.mockImplementation(() => Promise.resolve(page('', 500)));

    await get().catch(() => undefined);

    const paid = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => !url.startsWith('https://x.by'));
    expect(paid).toHaveLength(5);
    for (const url of paid) expect(url).toMatch(PAID_SCRAPER_ORIGIN);
    delete process.env.SCRAPEOPS_API_KEY;
  });

  it('asks ScrapingAnt, then ScraperAPI, first for a site without a country', async () => {
    withSpareKeys();
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('', 500)) // scrapingant
      .mockResolvedValueOnce(page(REAL)); // scraperapi

    await expect(get({ usable: protection.usable, renderWaitMs: 10_000 })).resolves.toBe(REAL);

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

  // Measured: a site's own block reaches us as ScraperAPI 500 / ScrapingAnt 423, a refused key as
  // 401 / 403 — only the latter benches the provider.
  it('benches ScrapingAnt for a refused key, not ScraperAPI for a blocked site', async () => {
    withSpareKeys();
    fetchMock.mockImplementation(() => Promise.resolve(page(CHALLENGE)));
    fetchMock
      .mockResolvedValueOnce(page(CHALLENGE)) // plain
      .mockResolvedValueOnce(page('', 403)) // scrapingant: key refused
      .mockResolvedValueOnce(page('', 500)); // scraperapi: the site blocked it
    await get().catch(() => undefined);

    fetchMock.mockClear();
    await get().catch(() => undefined);

    expect(calledHosts().slice(0, 2)).toEqual(['x.by', 'api.scraperapi.com']);
  });

  // Their free tiers cannot pick a country: for a geo-fenced site they would only hear «blocked».
  it('leaves the two without a country out for a geo-fenced site', async () => {
    withSpareKeys();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('githubusercontent') ? page('') : page('', 500)),
    );

    const err = (await get({ ...protection, country: 'by' }).catch((e: unknown) => e)) as Error;

    expect(calledHosts()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/scrapingant|scraperapi/)]),
    );
    expect(err.message).not.toMatch(/scrapingant|scraperapi/);
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
