import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { PaidRungsUnavailableError, SourceUnavailableError } from '../../source-adapter';
import { fetchProtected } from '../ladder';
import type { Protection } from '../ladder';
import { resetSpentProviders } from '../providers';

const fetchMock = undiciFetchMock();

const REAL = '<html><select id="sorter"></select></html>';
const CHALLENGE = '<html>Just a moment…</html>';
const protection: Protection = { usable: (html) => html.includes('id="sorter"'), country: 'by' };
const page = (body: string, status = 200): Response => new Response(body, { status });
const get = () => fetchProtected({ url: 'https://x.by/a', host: 'x.by', protection });
/** The provider each call went to, by host — the plain rung is the target itself. */
const calledHosts = (): string[] => fetchMock.mock.calls.map(([url]) => new URL(String(url)).host);

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
    // The geo and the anti-bot tier go to the provider; no render unless the source asks.
    const zenrows = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(zenrows.get('proxy_country')).toBe('by');
    expect(zenrows.get('premium_proxy')).toBe('true');
    expect(zenrows.has('js_render')).toBe(false);
  });

  it('asks for a render and its settle time only when the source needs one', async () => {
    fetchMock.mockResolvedValueOnce(page(CHALLENGE)).mockResolvedValueOnce(page(REAL));

    await fetchProtected({
      url: 'https://x.by/a',
      host: 'x.by',
      protection: { ...protection, renderWaitMs: 8000 },
    });

    const zenrows = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
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
