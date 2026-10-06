import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';

const fixture = readFileSync(join(__dirname, 'fixtures/gsz-search.html'), 'utf8');

describe('gsz source', () => {
  const fetchMock = undiciFetchMock();

  it.each([
    ['https://gsz.gov.by/registration/vacancy-search/?district=14712', true],
    ['https://gsz.gov.by/registration/employer/vacancy/x/detail-public/', false],
    ['https://gsz.gov.by/', false],
  ])('matches(%s) → %s', (url, expected) => {
    expect(sourceAdapter('gsz').matches(url)).toBe(expected);
  });

  it('pins newest-first, 50 per page and page 1, then follows the pager', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response(fixture.replace(/page-link/g, 'x')));

    const { listings } = await sourceAdapter('gsz').fetch(
      'https://gsz.gov.by/registration/vacancy-search/?district=14712&sort_by=salary_asc&page=4',
    );

    const [first, second] = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(first.get('sort_by')).toBe('sort_published_at_desc');
    expect(first.get('paginate_by')).toBe('50');
    expect(first.get('page')).toBe('1');
    expect(second.get('page')).toBe('2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The same three cards on both pages — deduped by id.
    expect(listings).toHaveLength(3);
  });
});
