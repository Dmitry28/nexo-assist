import { Logger } from '@nestjs/common';

import { makeListing } from '@/__tests__/helpers/listing';

import { paginate } from '../paginate';
import type { ParsedPage } from '../paginate';

describe('paginate', () => {
  const logger = new Logger('test');
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    // A fresh Response per call — its body can only be read once; parsePage ignores the content.
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response('<html></html>')));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('follows nextUrl across pages and stops at the last page', async () => {
    const pages: ParsedPage[] = [
      { listings: [makeListing(1)], nextUrl: 'p2' },
      { listings: [makeListing(2)], nextUrl: null },
    ];
    const parsePage = jest.fn().mockImplementation(() => pages.shift());

    const result = await paginate('p1', parsePage, logger);

    expect(result.map((l) => l.externalId)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates listings that shift between pages', async () => {
    const pages: ParsedPage[] = [
      { listings: [makeListing(1), makeListing(2)], nextUrl: 'p2' },
      { listings: [makeListing(2), makeListing(3)], nextUrl: null },
    ];
    const parsePage = jest.fn().mockImplementation(() => pages.shift());

    const result = await paginate('p1', parsePage, logger);

    expect(result.map((l) => l.externalId)).toEqual(['1', '2', '3']);
  });

  it('stops at MAX_PAGES even if more pages are advertised', async () => {
    // Every page yields a unique listing and advertises a next → only the cap halts it.
    let id = 0;
    const parsePage = jest
      .fn()
      .mockImplementation(() => ({ listings: [makeListing(++id)], nextUrl: 'next' }));

    const result = await paginate('p1', parsePage, logger);

    expect(result).toHaveLength(5); // MAX_PAGES
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('stops on an empty page', async () => {
    const parsePage = jest.fn().mockReturnValue({ listings: [], nextUrl: 'next' });

    expect(await paginate('p1', parsePage, logger)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the first page fails — an outage must not look like an empty search', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    await expect(paginate('p1', jest.fn(), logger)).rejects.toThrow('boom');
  });

  it('returns the collected listings when a later page fails', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response('<html></html>')))
      .mockRejectedValueOnce(new Error('boom'));
    const parsePage = jest.fn().mockReturnValue({ listings: [makeListing(1)], nextUrl: 'p2' });

    const result = await paginate('p1', parsePage, logger);

    expect(result.map((l) => l.externalId)).toEqual(['1']);
  });
});
