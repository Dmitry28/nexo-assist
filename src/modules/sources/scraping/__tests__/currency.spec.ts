import { asCurrency } from '../currency';

describe('asCurrency', () => {
  it.each([
    ['BYR', 'BYN'],
    ['rur', 'RUB'],
    ['USD', 'USD'],
    [' eur ', 'EUR'],
    [undefined, undefined],
  ])('%p → %p', (value, expected) => {
    expect(asCurrency(value)).toBe(expected);
  });
});
