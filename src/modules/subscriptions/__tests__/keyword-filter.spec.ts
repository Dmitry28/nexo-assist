import {
  MAX_KEYWORDS_CHARS,
  MAX_PHRASES,
  matchesKeywords,
  parseKeywords,
  readKeywords,
  storeKeywords,
} from '../keyword-filter';

describe('parseKeywords', () => {
  it('splits on commas and normalizes case, ё and spaces (NBSP included)', () => {
    expect(parseKeywords(' Бампер  Задний ,Крышка багажника, ЁЛКА ')).toEqual([
      'бампер задний',
      'крышка багажника',
      'елка',
    ]);
  });

  it('drops empty and repeated phrases, and refuses an answer with no words', () => {
    expect(parseKeywords('бампер, , Бампер,')).toEqual(['бампер']);
    expect(parseKeywords(' , ,')).toBeNull();
  });

  it(`keeps at most ${MAX_PHRASES} phrases and ${MAX_KEYWORDS_CHARS} characters`, () => {
    expect(parseKeywords(Array.from({ length: 20 }, (_, i) => `слово${i}`).join(','))).toHaveLength(
      MAX_PHRASES,
    );
    const long = parseKeywords(['а'.repeat(150), 'б'.repeat(150)].join(','));
    expect(storeKeywords(long!).length).toBeLessThanOrEqual(MAX_KEYWORDS_CHARS);
  });

  it('round-trips through storage', () => {
    expect(readKeywords(storeKeywords(['бампер задний', 'фара']))).toEqual([
      'бампер задний',
      'фара',
    ]);
    expect(readKeywords(null)).toBeNull();
  });
});

describe('matchesKeywords', () => {
  const phrases = ['бампер задний', 'лобов стекл'];

  it.each([
    ['Задний бампер в сборе', true], // word order is free
    ['Бампер задний (дефект)', true],
    ['Стекло лобовое (ветровое)', true], // a stem matches every ending
    ['Лобового стекла нет', true],
    ['Бампер передний', false], // every word of a phrase must be there
    ['Усилитель заднего бампера', false], // «заднего» is not «задний» — the part is not the bumper
    ['Фара левая', false],
  ])('%s → %s', (text, expected) => {
    expect(matchesKeywords(text, phrases)).toBe(expected);
  });

  it('reads ё as е and ignores case on both sides', () => {
    expect(matchesKeywords('Ёлочная ЗЕРКАЛЬНАЯ', parseKeywords('ЕЛОЧН, зёркальн')!)).toBe(true);
  });
});
