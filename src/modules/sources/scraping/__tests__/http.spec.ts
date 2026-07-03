import { fetchHtml } from '../http';

describe('fetchHtml', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  /** A Response whose final URL is set — constructed Responses default to ''. */
  const responseAt = (url: string): Response => {
    const res = new Response('<html>ok</html>', { status: 200 });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };

  it('returns the body on success', async () => {
    fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

    expect(await fetchHtml('https://x.by', 'x.by')).toBe('<html>ok</html>');
  });

  it('accepts a redirect that stays on the pinned host', async () => {
    fetchMock.mockResolvedValue(responseAt('https://re.x.by/normalized'));

    expect(await fetchHtml('https://x.by/l', 'x.by')).toBe('<html>ok</html>');
  });

  it('throws when a redirect leaves the pinned host — no SSRF via the source', async () => {
    fetchMock.mockResolvedValue(responseAt('https://evil.com/x'));

    await expect(fetchHtml('https://x.by/l', 'x.by')).rejects.toThrow('Redirected off');
  });

  it('throws on a non-OK status', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    await expect(fetchHtml('https://x.by', 'x.by')).rejects.toThrow('HTTP 503');
  });

  it('throws when the declared Content-Length exceeds the cap', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );

    await expect(fetchHtml('https://x.by', 'x.by')).rejects.toThrow('Content-Length');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(fetchHtml('https://x.by', 'x.by')).rejects.toThrow('network down');
  });
});
