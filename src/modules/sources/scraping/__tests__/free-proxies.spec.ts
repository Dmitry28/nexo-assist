import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { freeProxyRung, parseProxyList, resetFreeProxies } from '../free-proxies';

const fetchMock = undiciFetchMock();

const REAL = '<select id="sorter"></select>';
const page = (body: string, status = 200): Response => new Response(body, { status });
const usable = (html: string): boolean => html.includes('id="sorter"');
const rung = (url = 'https://x.by/a') => freeProxyRung(url, 'x.by', usable, 'by');
/** The proxy each target request went through — undici's ProxyAgent keeps it on a symbol. */
const proxiedCalls = (): unknown[][] =>
  (fetchMock.mock.calls as unknown[][]).filter(([url]) => String(url).startsWith('https://x.by'));

describe('parseProxyList', () => {
  it('keeps http proxies on public IPv4 literals only', () => {
    const list = [
      'http://93.125.3.22:8080',
      'socks5://80.249.81.179:9050', // SOCKS: undici speaks HTTP CONNECT only
      'https://178.124.195.80:8080', // the lists' word for «tunnels https»
      'http://proxy.example.by:8080', // a host name could be re-pointed by DNS
      'http://93.125.3.23:0',
      'http://93.125.3.24:70000',
    ].join('\n');
    expect(parseProxyList(list)).toEqual(['93.125.3.22:8080', '178.124.195.80:8080']);
  });

  // A list entry must never point the pod at itself, the cluster or the cloud metadata service.
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
  ])('drops %s', (ip) => {
    expect(parseProxyList(`http://${ip}:8080`)).toEqual([]);
  });
});

describe('freeProxyRung — the lists', () => {
  beforeEach(() => resetFreeProxies());

  it('merges both lists, each read in its own format, without duplicates', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent')
          ? page('http://1.1.1.1:80')
          : url.includes('geonode')
            ? page(
                JSON.stringify({
                  data: [
                    { ip: '1.1.1.1', port: '80', protocols: ['http'] },
                    { ip: '2.2.2.2', port: '8080', protocols: ['https'] },
                    { ip: '3.3.3.3', port: '1080', protocols: ['socks4'] },
                  ],
                }),
              )
            : page('Just a moment'),
      ),
    );

    await expect(rung().run(30_000)).rejects.toThrow('2 free by proxies failed');
  });

  it('still works when one list is down', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent')
          ? page('', 503)
          : url.includes('geonode')
            ? page('{"data":[{"ip":"2.2.2.2","port":"8080","protocols":["https"]}]}')
            : page(REAL),
      ),
    );

    await expect(rung().run(30_000)).resolves.toBe(REAL);
  });
});

describe('freeProxyRung', () => {
  beforeEach(() => resetFreeProxies());

  it('returns the first real page and tries that proxy first next time', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent')
          ? page('http://1.1.1.1:80\nhttp://2.2.2.2:80')
          : page(REAL),
      ),
    );

    await expect(rung().run(30_000)).resolves.toBe(REAL);
    fetchMock.mockClear();
    await rung().run(30_000);

    // The list is cached for the hour: the second run asks no list.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('githubusercontent'))).toBe(
      false,
    );
  });

  it('fails without trying anything when no proxy is listed', async () => {
    fetchMock.mockResolvedValueOnce(page('', 500));

    await expect(rung().run(30_000)).rejects.toThrow('no free by proxy listed');
    expect(proxiedCalls()).toHaveLength(0);
  });

  it('drops the proxies that failed from this hour’s list', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent') ? page('http://1.1.1.1:80') : page('Just a moment'),
      ),
    );

    await expect(rung().run(30_000)).rejects.toThrow('1 free by proxies failed');
    fetchMock.mockClear();
    await expect(rung().run(30_000)).rejects.toThrow('every free by proxy failed x.by this hour');
    expect(proxiedCalls()).toHaveLength(0);
  });

  // Measured: the proxies that read idriver and av.by never got through bid.cars.
  it('keeps a proxy that failed one site for the others', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent')
          ? page('http://1.1.1.1:80')
          : page(url.startsWith('https://y.by') ? 'Just a moment' : REAL),
      ),
    );

    await expect(freeProxyRung('https://y.by/a', 'y.by', usable, 'by').run(30_000)).rejects.toThrow(
      '1 free by proxies failed',
    );
    await expect(rung().run(30_000)).resolves.toBe(REAL);
  });

  // Cleartext through a stranger's proxy could be altered on the way.
  it('never fetches a plain-http page through a public proxy', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('githubusercontent') ? page('http://1.1.1.1:80') : page(REAL)),
    );

    await expect(rung('http://x.by/a').run(30_000)).rejects.toThrow('free by proxies failed');
    expect(proxiedCalls()).toHaveLength(0);
  });
});

describe('freeProxyRung — failures', () => {
  beforeEach(() => resetFreeProxies());

  // A redirect seen only through a stranger's proxy says something about that IP, not the URL.
  it('counts even an off-host redirect as the proxy failing', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent')
          ? page('http://1.1.1.1:80')
          : new Response(null, { status: 301, headers: { location: 'https://evil.com/' } }),
      ),
    );

    await expect(rung().run(30_000)).rejects.toThrow('1 free by proxies failed');
  });

  it('asks for a new list soon once this one ran dry', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('githubusercontent') ? page('http://1.1.1.1:80') : page('Just a moment'),
      ),
    );
    await rung()
      .run(30_000)
      .catch(() => undefined);
    await rung()
      .run(30_000)
      .catch(() => undefined); // the list is empty now

    fetchMock.mockClear();
    jest.advanceTimersByTime(5 * 60 * 1000);
    await rung()
      .run(30_000)
      .catch(() => undefined);

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('githubusercontent'))).toBe(
      true,
    );
    jest.useRealTimers();
  });
});
