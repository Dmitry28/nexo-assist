import { undiciFetchMock } from '@/__tests__/helpers/undici';

import * as paginateModule from '../scraping/paginate';
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
