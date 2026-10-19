import { siteName, watchedItem } from '../sources';

describe('siteName', () => {
  it('names a registered source by its site, an unknown id by itself', () => {
    expect(siteName('kufar-travel')).toBe('travel.kufar.by');
    expect(siteName('retired-source')).toBe('retired-source');
  });
});

describe('watchedItem', () => {
  it('names a single listing by its canonical link, and nothing else', () => {
    expect(watchedItem('kufar', 'https://re.kufar.by/vi/grodno/kupit/dom/7')).toEqual({
      id: '7',
      url: 'https://re.kufar.by/vi/7',
    });
    expect(watchedItem('kufar', 'https://re.kufar.by/l/grodno')).toBeUndefined();
    expect(watchedItem('realt', 'https://realt.by/sale-plots/object/7/')).toBeUndefined();
    // A stored URL that no longer parses must not throw into a delivery.
    expect(watchedItem('kufar', 'not a url')).toBeUndefined();
  });
});
