import { extractUrl, sourceOf } from './source-detection';

describe('extractUrl', () => {
  it('pulls the first http(s) url from text', () => {
    expect(extractUrl('watch this https://kufar.by/l/x please')).toBe('https://kufar.by/l/x');
  });

  it('returns null when there is no url', () => {
    expect(extractUrl('hello there')).toBeNull();
  });
});

describe('sourceOf', () => {
  it.each([
    ['https://www.kufar.by/l/r~minsk', 'kufar'],
    ['https://re.kufar.by/l/minsk', 'kufar'],
    ['https://realt.by/sale/flats/', 'realt'],
  ])('detects %s as %s', (url, source) => {
    expect(sourceOf(url)).toBe(source);
  });

  it('returns null for an unsupported host', () => {
    expect(sourceOf('https://example.com/search')).toBeNull();
  });

  it('returns null for a non-url string', () => {
    expect(sourceOf('just text')).toBeNull();
  });
});
