import { redactBreadcrumb, redactSecrets } from '../redact';

describe('redactSecrets', () => {
  it.each([
    [
      'https://api.zenrows.com/v1/?apikey=zr-secret&url=x',
      'https://api.zenrows.com/v1/?apikey=[redacted]&url=x',
    ],
    [
      'https://api.scrape.do/?url=x&token=sd-secret',
      'https://api.scrape.do/?url=x&token=[redacted]',
    ],
    ['apikey=zr-secret&super=true', 'apikey=[redacted]&super=true'],
    [
      'https://api.scrapfly.io/scrape?key=sf-secret&url=x',
      'https://api.scrapfly.io/scrape?key=[redacted]&url=x',
    ],
  ])('strips the key from %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('leaves a param that merely ends in «key» alone', () => {
    expect(redactSecrets('?monkey=1&sort_key=2')).toBe('?monkey=1&sort_key=2');
  });

  it('leaves an ordinary URL alone', () => {
    const url = 'https://re.kufar.by/l/minsk?cursor=abc&sort=lst.d';
    expect(redactSecrets(url)).toBe(url);
  });
});

describe('redactBreadcrumb', () => {
  it("strips Sentry's fetch breadcrumb — its URL and its query", () => {
    const crumb = redactBreadcrumb({
      category: 'http',
      data: {
        url: 'https://api.scrape.do/',
        'http.query': '?token=sd-secret&url=x',
        status_code: 200,
      },
    });
    expect(JSON.stringify(crumb)).not.toContain('secret');
    expect(crumb.data?.status_code).toBe(200);
  });
});
