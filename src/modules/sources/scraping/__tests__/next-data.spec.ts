import { SourceUnavailableError } from '../../source-adapter';
import {
  asArray,
  asCoordinates,
  asNumber,
  asPositiveNumber,
  asPrice,
  asRecord,
  asText,
  asTexts,
  parseNextData,
  requireArray,
  requireNextData,
  withIds,
} from '../next-data';

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

describe('asArray', () => {
  it('passes an array through unchanged', () => {
    const value = [{ p: 'address' }];
    expect(asArray(value)).toBe(value);
  });

  // Same job as asRecord, one level over: only the array-ness is checked, so a layout change
  // stops here instead of reaching `.map`/`.find` as "x is not a function".
  it.each([
    ['an object', {}],
    ['null', null],
    ['a string', 'ads'],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(asArray(value)).toBeUndefined();
  });
});

describe('asText', () => {
  it('trims usable text', () => {
    expect(asText('  Минск  ')).toBe('Минск');
  });

  // A source spells "no value" four ways; a Listing field holding whitespace is a blank line
  // in the digest, so all four must read as absent.
  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('treats %s as absent', (_label, value) => {
    expect(asText(value)).toBeUndefined();
  });
});

describe('asNumber', () => {
  // kufar wraps some numeric parameters in a one-element array — see asNumber's docstring.
  it('unwraps a one-element array', () => {
    expect(asNumber([11])).toBe(11);
  });

  it.each([
    ['a longer array', [11, 9]],
    ['an empty array', []],
  ])('reads %s as no value', (_label, value) => {
    expect(asNumber(value)).toBeUndefined();
  });

  it('passes a number through', () => {
    expect(asNumber(114.6)).toBe(114.6);
  });

  it('parses a numeric string — kufar sends its parameters that way', () => {
    expect(asNumber('12.5')).toBe(12.5);
  });

  // A unit inside the value means the field is not what the caller assumed. Guessing 12 from
  // "12 сот." would put a made-up number in a card, where it reads as fact.
  it.each([
    ['a value carrying its unit', '12 сот.'],
    ['blank', '   '],
    ['not a number at all', 'Не указано'],
    ['null', null],
    ['infinity', Infinity],
    ['NaN', NaN],
  ])('treats %s as absent', (_label, value) => {
    expect(asNumber(value)).toBeUndefined();
  });
});

describe('asPositiveNumber', () => {
  it('passes a positive number through', () => {
    expect(asPositiveNumber('1979')).toBe(1979);
  });

  // These sources spell "not filled in" as a zero for an area, a room count or a year.
  it.each([
    ['zero', 0],
    ['a negative', -5],
  ])('treats %s as absent', (_label, value) => {
    expect(asPositiveNumber(value)).toBeUndefined();
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

describe('asCoordinates', () => {
  it('reads a [longitude, latitude] pair — longitude first', () => {
    expect(asCoordinates([27.53, 53.9])).toEqual({ lat: 53.9, lon: 27.53 });
  });

  it.each([
    ['malformed', 'not a pair'],
    ['half-filled', [27.53]],
    ['out of range', [27.53, 953.9]],
    // A zeroed pair is an unfilled field, not a spot in the Atlantic.
    ['zeroed', [0, 0]],
  ])('drops %s input rather than pinning the wrong place', (_label, value) => {
    expect(asCoordinates(value)).toBeUndefined();
  });
});

describe('requireNextData', () => {
  it('returns the blob, and throws a source error on a page without one', () => {
    expect(requireNextData(wrap('{"a":1}'), 'kufar')).toEqual({ a: 1 });
    expect(() => requireNextData('<html>bot wall</html>', 'kufar')).toThrow(SourceUnavailableError);
  });
});

describe('requireArray', () => {
  it('returns the array — an empty one is a real zero-result page', () => {
    expect(requireArray([], 'kufar', 'listing.ads')).toEqual([]);
  });

  it.each([undefined, null, {}, 'x'])('throws a source error on %p', (value) => {
    expect(() => requireArray(value, 'kufar', 'listing.ads')).toThrow(SourceUnavailableError);
  });
});

describe('withIds', () => {
  const idOf = (item: { id?: unknown }): unknown => item.id;

  it('keeps numeric and text ids, drops an item without a usable one', () => {
    const items = [{ id: 1 }, { id: 'a7' }, { id: '  ' }, { id: Number.NaN }, {}];

    expect(withIds(items, idOf, 'kufar')).toEqual([{ id: 1 }, { id: 'a7' }]);
  });

  // A renamed id field: every listing would become "undefined" and merge into one.
  it('throws a source error when a non-empty page has no id at all', () => {
    expect(() => withIds([{}, {}], idOf, 'kufar')).toThrow(SourceUnavailableError);
  });

  it('accepts an empty page', () => {
    expect(withIds([], idOf, 'kufar')).toEqual([]);
  });
});

describe('asPrice', () => {
  it.each([
    ['1385000', true, 13850],
    [7500, true, 75],
    [45000.4, false, 45000],
    ['45000', false, 45000],
    ['49', true, undefined], // rounds to 0 — not a price
    [0.4, false, undefined],
    [-500, false, undefined],
    [0, false, undefined],
    ['12 BYN', false, undefined],
    [undefined, true, undefined],
  ])('asPrice(%p, minorUnits %p) → %p', (value, minorUnits, expected) => {
    expect(asPrice(value, { minorUnits })).toBe(expected);
  });
});

describe('asTexts', () => {
  it.each([
    [
      ['a', ' b ', '', 3, null],
      ['a', 'b'],
    ],
    ['single', ['single']],
    [undefined, []],
    [{}, []],
  ])('asTexts(%p) → %p', (value, expected) => {
    expect(asTexts(value)).toEqual(expected);
  });
});
