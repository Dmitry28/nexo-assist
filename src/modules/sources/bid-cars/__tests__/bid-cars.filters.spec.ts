import { UnsupportedSearchError } from '../../source-adapter';
import { auctionFilters } from '../bid-cars.filters';

const sample =
  'https://bid.cars/ru/search/results?search-type=filters&status=Active&type=Automobile&make=Volkswagen&model=Atlas';

describe('bid.cars auctionFilters', () => {
  it('maps the pasted make, model, type and live status', () => {
    expect(auctionFilters(`${sample}&year-from=2018&year-to=2024`)).toEqual({
      make: 'VOLKSWAGEN',
      model: 'ATLAS',
      yearFrom: 2018,
      yearTo: 2024,
      vehicle: { copart: 'VEHTYPE_V' },
      houses: ['copart', 'iaai'],
    });
  });

  it('keeps one house when the link names it', () => {
    expect(auctionFilters(`${sample}&auction-type=Copart`).houses).toEqual(['copart']);
    expect(auctionFilters(`${sample}&auction-type=IAAI`).houses).toEqual(['iaai']);
  });

  it('drops All / empty as «no filter»', () => {
    expect(auctionFilters('https://bid.cars/ru/search/results?make=All&model=&type=All')).toEqual({
      houses: ['copart', 'iaai'],
    });
  });

  it('refuses a filter the auctions cannot honour', () => {
    expect(() => auctionFilters(`${sample}&damage=Flood`)).toThrow(UnsupportedSearchError);
    expect(() => auctionFilters('https://bid.cars/ru/search/results?type=Motorcycle')).toThrow(
      UnsupportedSearchError,
    );
    expect(() => auctionFilters(`${sample}&year-from=abc`)).toThrow(UnsupportedSearchError);
    expect(() => auctionFilters('https://bid.cars/ru/search/results?status=All')).toThrow(
      UnsupportedSearchError,
    );
  });
});
