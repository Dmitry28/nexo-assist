import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { SourceUnavailableError } from '../../source-adapter';
import { fetchHtml } from '../http';

const fetchMock = undiciFetchMock();

describe('fetchHtml', () => {
  afterEach(() => jest.restoreAllMocks());

  /** A 3xx redirect response pointing at `location`. */
  const redirectTo = (location: string): Response =>
    new Response(null, { status: 301, headers: { location } });

  it('returns the body on success', async () => {
    fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

    expect(await fetchHtml({ url: 'https://x.by', host: 'x.by' })).toBe('<html>ok</html>');
  });

  it('follows a redirect that stays on the pinned host', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('https://re.x.by/normalized'))
      .mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));

    expect(await fetchHtml({ url: 'https://x.by/l', host: 'x.by' })).toBe('<html>ok</html>');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://re.x.by/normalized', expect.anything());
  });

  it('throws before following a redirect off the pinned host — no SSRF via the source', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://evil.com/x'));

    await expect(fetchHtml({ url: 'https://x.by/l', host: 'x.by' })).rejects.toThrow(
      'Redirected off',
    );
    // The off-host hop is rejected before it is ever requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a relative redirect Location against the current URL', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('/normalized'))
      .mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));

    expect(await fetchHtml({ url: 'https://x.by/l', host: 'x.by' })).toBe('<html>ok</html>');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://x.by/normalized', expect.anything());
  });

  it('throws on a redirect loop past the hop cap', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://x.by/next'));

    await expect(fetchHtml({ url: 'https://x.by/l', host: 'x.by' })).rejects.toThrow(
      'Too many redirects',
    );
  });

  it('reports a non-OK status as the source being unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    // Typed, so callers can tell "the site is down" from "our code is broken" without
    // parsing messages.
    const err = await fetchHtml({ url: 'https://x.by', host: 'x.by' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err).toHaveProperty('message', expect.stringContaining('HTTP 503'));
  });

  it('throws when the declared Content-Length exceeds the cap', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );

    // An oversized response is the source misbehaving, not our bug — pin the classification,
    // it is the least self-evident of the three.
    const err = await fetchHtml({ url: 'https://x.by', host: 'x.by' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err).toHaveProperty('message', expect.stringContaining('Content-Length'));
  });

  it('reports a network failure the same way, keeping the original error as cause', async () => {
    const cause = new Error('network down');
    fetchMock.mockRejectedValue(cause);

    const err = await fetchHtml({ url: 'https://x.by', host: 'x.by' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err).toHaveProperty('cause', cause); // original kept for debugging
  });

  describe('proxy', () => {
    const proxyEnv = process.env.SCRAPE_PROXY_URL;
    afterEach(() => {
      if (proxyEnv === undefined) delete process.env.SCRAPE_PROXY_URL;
      else process.env.SCRAPE_PROXY_URL = proxyEnv;
    });

    /** undici's per-request transport hook (absent from the DOM RequestInit types) — set
     *  only when the request must be proxied. */
    const dispatcherOf = (init: unknown): unknown => (init as { dispatcher?: unknown }).dispatcher;

    it('routes through the proxy when the source asks for it and one is configured', async () => {
      process.env.SCRAPE_PROXY_URL = 'http://user:pass@proxy.test:8888';
      fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

      await fetchHtml({ url: 'https://x.by', host: 'x.by', useProxy: true });

      expect(dispatcherOf(fetchMock.mock.calls[0][1])).toBeDefined();
    });

    it('fetches directly when the source does not ask for a proxy', async () => {
      process.env.SCRAPE_PROXY_URL = 'http://user:pass@proxy.test:8888';
      fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

      await fetchHtml({ url: 'https://x.by', host: 'x.by' });

      expect(dispatcherOf(fetchMock.mock.calls[0][1])).toBeUndefined();
    });

    it('fetches directly when no proxy is configured, even if the source asks', async () => {
      delete process.env.SCRAPE_PROXY_URL;
      fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

      await fetchHtml({ url: 'https://x.by', host: 'x.by', useProxy: true });

      expect(dispatcherOf(fetchMock.mock.calls[0][1])).toBeUndefined();
    });
  });
});
