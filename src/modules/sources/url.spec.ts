import { extractUrl } from './url';

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
});
