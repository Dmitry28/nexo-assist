import { Logger } from '@nestjs/common';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import * as paginateModule from '../scraping/paginate';
import { SourceUnavailableError } from '../source-adapter';
import type { Listing } from '../source-adapter';
import type { SourceDefinition } from '../source-definition';
import { createSourceAdapters } from '../source-definition';

const listing = (id: string) => ({
  externalId: id,
  link: `https://a.by/${id}`,
  title: id,
  listTime: '',
  images: [],
  details: [],
});

type Paged = Extract<SourceDefinition, { page: unknown }>;

const define = (over: Partial<Paged> = {}): Paged => ({
  id: 'kufar',
  host: 'a.by',
  sample: 'https://a.by/s',
  about: 'test',
  page: { param: 'page', first: 1 },
  parse: () => ({ listings: [listing('1')], next: false }),
  ...over,
});

describe('createSourceAdapters', () => {
  const fetchMock = undiciFetchMock();

  it('derives the duplicate-check params from pins, paging and noise', () => {
    const [adapter] = createSourceAdapters([
      define({ pins: { sort: 'new', size: '50' }, noise: ['utm'] }),
    ]);

    expect(adapter.volatileParams).toEqual(['sort', 'size', 'page', 'utm']);
  });

  it('leaves a subdomain another definition owns to that one', () => {
    const [parent, child] = createSourceAdapters([
      define({ host: 'a.by' }),
      define({ id: 'kufar-travel', host: 'travel.a.by' }),
    ]);

    expect(parent.matches('https://re.a.by/l')).toBe(true);
    expect(parent.matches('https://travel.a.by/l')).toBe(false);
    expect(child.matches('https://travel.a.by/l')).toBe(true);
  });

  it('matches only the search path when one is declared, trailing slash or not', () => {
    const [adapter] = createSourceAdapters([define({ searchPath: '/search/' })]);

    expect(adapter.matches('https://a.by/search')).toBe(true);
    expect(adapter.matches('https://a.by/search/?q=1')).toBe(true);
    expect(adapter.matches('https://a.by/item/1')).toBe(false);
  });

  it('counts pages from `first` and hands each parse the raw total sent before it', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const seen: number[] = [];
    const [adapter] = createSourceAdapters([
      define({
        page: { param: 'p', first: 0 },
        parse: (_html, { page, sent }) => {
          seen.push(sent);
          return { listings: [listing(String(page))], next: page < 2, sent: 10 };
        },
      }),
    ]);

    await adapter.fetch('https://a.by/s?p=7');

    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('p'))).toEqual(
      ['0', '1'],
    );
    expect(seen).toEqual([0, 10]);
  });

  it('forces the pins over what the pasted URL says', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const [adapter] = createSourceAdapters([define({ pins: { sort: 'new' } })]);

    await adapter.fetch('https://a.by/s?sort=price&q=1');

    const sent = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(sent.get('sort')).toBe('new');
    expect(sent.get('q')).toBe('1');
  });

  it('passes the proxy and path pin through to the walk', async () => {
    const walk = jest.spyOn(paginateModule, 'paginate').mockResolvedValue({
      listings: [],
      complete: true,
      capped: false,
    });
    const [adapter] = createSourceAdapters([define({ useProxy: true, pinPath: true })]);

    await adapter.fetch('https://a.by/s');

    expect(walk).toHaveBeenCalledWith(expect.objectContaining({ useProxy: true, pinPath: true }));
    walk.mockRestore();
  });

  it('stops on an empty cursor token', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const [adapter] = createSourceAdapters([
      {
        id: 'kufar',
        host: 'a.by',
        sample: 'https://a.by/s',
        about: 'test',
        cursor: { param: 'cursor' },
        parse: () => ({ listings: [listing('1')], next: '' }),
      },
    ]);

    await adapter.fetch('https://a.by/s');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('matches a search path given as a pattern', () => {
    const [adapter] = createSourceAdapters([define({ searchPath: /^\/[a-z]+$/ })]);

    expect(adapter.matches('https://a.by/pogorany/')).toBe(true);
    expect(adapter.matches('https://a.by/api/x')).toBe(false);
  });

  it('fetches what requestUrl maps the pasted link to', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const [adapter] = createSourceAdapters([
      {
        id: 'gridom',
        host: 'a.by',
        sample: 'https://a.by/dev',
        about: 'test',
        singlePage: true,
        requestUrl: (url) => `${url}/data.json`,
        parse: () => ({ listings: [listing('1')] }),
      },
    ]);

    await adapter.fetch('https://a.by/dev');

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://a.by/dev/data.json');
  });

  it('fetches a single page once, adding no paging param', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const [adapter] = createSourceAdapters([
      {
        id: 'ghb',
        host: 'a.by',
        sample: 'https://a.by/list',
        about: 'test',
        singlePage: true,
        parse: () => ({ listings: [listing('1')] }),
      },
    ]);

    await adapter.fetch('https://a.by/list?x=1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://a.by/list?x=1');
    expect(adapter.volatileParams).toEqual([]);
  });

  it('follows a cursor token, starting without one', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const [adapter] = createSourceAdapters([
      {
        id: 'kufar',
        host: 'a.by',
        sample: 'https://a.by/s',
        about: 'test',
        cursor: { param: 'cursor' },
        parse: (_html, { page }) => ({
          listings: [listing(String(page))],
          next: page === 1 ? 'abc' : null,
        }),
      },
    ]);

    await adapter.fetch('https://a.by/s?cursor=old');

    expect(
      fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('cursor')),
    ).toEqual([null, 'abc']);
  });
});

describe('createSourceAdapters — load and enrich', () => {
  const fetchMock = undiciFetchMock();

  const define = (enrich: (l: Listing) => Promise<Listing>) =>
    createSourceAdapters([
      {
        id: 'gcn',
        host: 'a.by',
        sample: 'https://a.by/s',
        about: 'test',
        singlePage: true,
        load: async (url, get) => get(`${url}/grid`),
        enrich,
        parse: () => ({ listings: [listing('1'), listing('2')] }),
      },
    ])[0];

  it('fetches the body through load, then enriches every listing', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));

    const { listings, complete } = await define((l) =>
      Promise.resolve({ ...l, priceByn: 5 }),
    ).fetch('https://a.by/s');

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://a.by/s/grid');
    expect(listings.map((l) => l.priceByn)).toEqual([5, 5]);
    expect(complete).toBe(true);
  });

  // A listing whose visit failed is held back for the next poll — delivered without the field,
  // it would be marked seen and never come back with it. Every visit failing is the site breaking.
  it('holds back a listing whose visit failed, and fails the poll when every visit did', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const someFail = await define((l) =>
      l.externalId === '1' ? Promise.reject(new Error('down')) : Promise.resolve(l),
    ).fetch('https://a.by/s');

    expect(someFail).toMatchObject({ complete: false, listings: [{ externalId: '2' }] });
    await expect(
      define(() => Promise.reject(new Error('down'))).fetch('https://a.by/s'),
    ).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it('skips the visits when the caller needs only ids — the baseline', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('x')));
    const visit = jest.fn((l: Listing) => Promise.resolve(l));

    await define(visit).fetch('https://a.by/s', { idsOnly: true });

    expect(visit).not.toHaveBeenCalled();
  });
});
