import { makeListing } from '@/__tests__/helpers/listing';

import { SourceUnavailableError } from '../../source-adapter';
import { cardListings } from '../html';

describe('cardListings', () => {
  const read = (id: number | undefined) => (id === undefined ? undefined : makeListing(id));

  it('keeps one listing per id, dropping a card that could not be read', () => {
    expect(cardListings([1, undefined, 2, 1], read, 'bamper')).toEqual([
      makeListing(1),
      makeListing(2),
    ]);
  });

  it('reads no cards as an empty search', () => {
    expect(cardListings([], read, 'bamper')).toEqual([]);
  });

  it('throws when cards are on the page but none could be read — the layout changed', () => {
    expect(() => cardListings([undefined, undefined], read, 'bamper')).toThrow(
      SourceUnavailableError,
    );
  });
});
