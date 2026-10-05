import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { SearchRewrittenError, SourceUnavailableError } from '../../source-adapter';
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

  // realt answers a search it rewrites (any `addressV2` filter) with a redirect to a wider one.
  describe('pinPath', () => {
    const ok = () => new Response('<html>ok</html>', { status: 200 });

    it('refuses a redirect to another path, before following it', async () => {
      fetchMock.mockResolvedValue(redirectTo('https://x.by/belarus/sale/cottages'));

      const failure = fetchHtml({
        url: 'https://x.by/grodno-region/sale/cottages/taunhaus/?addressV2=1',
        host: 'x.by',
        pinPath: true,
      });

      await expect(failure).rejects.toBeInstanceOf(SearchRewrittenError);
      // Still a SourceUnavailableError — so it is reported as `kind: source`, not as our bug.
      await expect(failure).rejects.toBeInstanceOf(SourceUnavailableError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a trailing slash added', 'https://x.by/sale/flats/?x=1', 'https://x.by/sale/flats?x=1'],
      ['http → https on the same path', 'https://x.by:443/sale/flats/', 'http://x.by/sale/flats/'],
    ])('follows %s — the same search', async (_case, location, url) => {
      fetchMock.mockResolvedValueOnce(redirectTo(location)).mockResolvedValueOnce(ok());

      expect(await fetchHtml({ url, host: 'x.by', pinPath: true })).toBe('<html>ok</html>');
    });

    it('compares against the original path, not the previous hop', async () => {
      fetchMock
        .mockResolvedValueOnce(redirectTo('https://x.by/a/')) // trailing slash — fine
        .mockResolvedValueOnce(redirectTo('https://x.by/b')); // walks away from /a

      await expect(
        fetchHtml({ url: 'https://x.by/a', host: 'x.by', pinPath: true }),
      ).rejects.toThrow(SearchRewrittenError);
    });

    it('is opt-in: an unpinned fetch follows the same redirect (kufar does this legitimately)', async () => {
      fetchMock
        .mockResolvedValueOnce(redirectTo('https://x.by/listings?cat=1'))
        .mockResolvedValueOnce(ok());

      expect(await fetchHtml({ url: 'https://x.by/l/grodno', host: 'x.by' })).toBe(
        '<html>ok</html>',
      );
    });
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
