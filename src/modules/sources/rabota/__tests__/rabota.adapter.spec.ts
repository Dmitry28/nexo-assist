import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import { RabotaAdapter } from '../rabota.adapter';

const fixture = readFileSync(join(__dirname, 'fixtures/rabota-search.html'), 'utf8');
const lastPage = readFileSync(join(__dirname, 'fixtures/rabota-empty.html'), 'utf8');

describe('RabotaAdapter', () => {
  const fetchMock = undiciFetchMock();

  it.each([
    ['https://rabota.by/search/vacancy?area=2302', true],
    ['https://rabota.by/search/vacancy/?area=2302', true],
    ['https://rabota.by/search/vacancy/advanced', false],
    ['https://rabota.by/vacancy/138190032', false],
  ])('matches(%s) → %s', (url, expected) => {
    expect(new RabotaAdapter().matches(url)).toBe(expected);
  });

  // hh counts pages from 0: our first request is its page 0, the next its page 1.
  it('pins newest-first, 100 a page and page 0, then follows paging.next', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response(lastPage));

    await new RabotaAdapter().fetch(
      'https://rabota.by/search/vacancy?area=2302&order_by=salary_desc&items_on_page=20&page=3',
    );

    const [first, second] = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(first.get('order_by')).toBe('publication_time');
    expect(first.get('items_on_page')).toBe('100');
    expect(first.get('page')).toBe('0');
    expect(second.get('page')).toBe('1');
  });
});
