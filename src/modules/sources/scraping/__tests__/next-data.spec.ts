import { asRecord, parseNextData } from '../next-data';

const wrap = (json: string): string =>
  `<html><script id="__NEXT_DATA__" type="application/json">${json}</script></html>`;

describe('asRecord', () => {
  it('passes an object through unchanged', () => {
    const value = { props: 1 };
    expect(asRecord(value)).toBe(value);
  });

  // The whole point of the helper: these are the shapes a bare `as` cast used to wave through,
  // letting a changed layout read as an empty search instead of a loud failure.
  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'props'],
    ['a number', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(asRecord(value)).toBeUndefined();
  });
});

describe('parseNextData', () => {
  it('parses the embedded blob', () => {
    expect(parseNextData(wrap('{"props":{"a":1}}'))).toEqual({ props: { a: 1 } });
  });

  it.each([
    ['the open tag is absent', '<html>nothing here</html>'],
    ['the closing script tag is absent', '<script id="__NEXT_DATA__" type="application/json">{}'],
    ['the JSON is malformed', wrap('{not json')],
    // A blob that parses to a non-object is not a page — it must not reach the parsers as one.
    ['the blob is an array', wrap('[1,2]')],
    ['the blob is a number', wrap('42')],
  ])('returns null when %s', (_label, html) => {
    expect(parseNextData(html)).toBeNull();
  });

  it('keeps a "<" inside the JSON — the slice is positional, not a regex', () => {
    expect(parseNextData(wrap('{"title":"a < b"}'))).toEqual({ title: 'a < b' });
  });
});
