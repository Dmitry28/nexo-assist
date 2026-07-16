import { fetchHtml } from '../http';

describe('fetchHtml', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

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

  it('throws on a non-OK status', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    await expect(fetchHtml({ url: 'https://x.by', host: 'x.by' })).rejects.toThrow('HTTP 503');
  });

  it('throws when the declared Content-Length exceeds the cap', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );

    await expect(fetchHtml({ url: 'https://x.by', host: 'x.by' })).rejects.toThrow(
      'Content-Length',
    );
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(fetchHtml({ url: 'https://x.by', host: 'x.by' })).rejects.toThrow('network down');
  });
});
