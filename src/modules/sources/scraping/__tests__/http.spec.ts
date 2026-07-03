import { fetchHtml } from '../http';

describe('fetchHtml', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the body on success', async () => {
    fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));

    expect(await fetchHtml('https://x.by')).toBe('<html>ok</html>');
  });

  it('throws on a non-OK status', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    await expect(fetchHtml('https://x.by')).rejects.toThrow('HTTP 503');
  });

  it('throws when the declared Content-Length exceeds the cap', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );

    await expect(fetchHtml('https://x.by')).rejects.toThrow('Content-Length');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(fetchHtml('https://x.by')).rejects.toThrow('network down');
  });
});
