import { extractUrl, matchesHost, normalizeUrl, withParam, withoutParam } from '../url';

describe('extractUrl', () => {
  it('pulls the first http(s) url from text', () => {
    expect(extractUrl('watch this https://kufar.by/l/x please')).toBe('https://kufar.by/l/x');
  });

  it('strips trailing punctuation glued to the url', () => {
    expect(extractUrl('see https://kufar.by/l/x).')).toBe('https://kufar.by/l/x');
  });

  it('returns null when there is no url', () => {
    expect(extractUrl('hello there')).toBeNull();
  });

  it('rejects an absurdly long url — echoing it back would break the Telegram reply', () => {
    expect(extractUrl(`https://kufar.by/l/${'x'.repeat(3000)}`)).toBeNull();
  });
});

describe('matchesHost', () => {
  it.each([
    ['https://kufar.by/l/x', true],
    ['https://re.kufar.by/l/x', true],
    ['https://www.kufar.by/l/x', true],
    ['https://notkufar.by/x', false],
    ['https://kufar.by.evil.com/x', false],
    ['https://kufar.by:6379/x', false],
    ['not a url', false],
  ])('matchesHost(%s, kufar.by) → %s', (url, expected) => {
    expect(matchesHost(url, 'kufar.by')).toBe(expected);
  });
});

describe('normalizeUrl', () => {
  it('lowercases host, strips www, drops volatile + utm params, sorts, trims slash', () => {
    expect(
      normalizeUrl(
        'https://WWW.re.kufar.by/l/minsk/?sort=lst.d&price=1&cursor=abc&page=2&utm_source=x',
      ),
    ).toBe('https://re.kufar.by/l/minsk?price=1');
  });

  it('treats the same search as equal regardless of param order and pagination/sort', () => {
    expect(normalizeUrl('https://kufar.by/x?b=2&a=1&page=3')).toBe(
      normalizeUrl('https://kufar.by/x?a=1&sort=prc&b=2'),
    );
  });

  it('drops realt sortType + page', () => {
    expect(normalizeUrl('https://realt.by/sale/?sortType=createdAt&page=4&rooms=2')).toBe(
      'https://realt.by/sale?rooms=2',
    );
  });
});

describe('withParam', () => {
  it('adds or replaces the query param', () => {
    expect(withParam('https://x.by/a', 'page', '2')).toBe('https://x.by/a?page=2');
    expect(withParam('https://x.by/a?page=9&q=1', 'page', '2')).toBe('https://x.by/a?page=2&q=1');
  });
});

describe('withoutParam', () => {
  it('removes the query param and leaves the rest', () => {
    expect(withoutParam('https://x.by/a?cursor=abc&q=1', 'cursor')).toBe('https://x.by/a?q=1');
  });
});
