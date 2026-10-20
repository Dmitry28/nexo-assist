import { ADAPTERS, siteName, watchedItem } from '../sources';

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
    expect(watchedItem('gsz', 'https://gsz.gov.by/registration/vacancy-search/')).toBeUndefined();
    // A stored URL that no longer parses must not throw into a delivery.
    expect(watchedItem('kufar', 'not a url')).toBeUndefined();
  });
});

// Copart's search is paid page by page (Imperva refuses our IPs): its window, and bid.cars's
// fallback walk of it — what DAILY_CREDIT_BUDGET counts them at.
describe('paid polls of the auction walks', () => {
  it.each([
    ['copart', 6],
    ['bid-cars', 6],
  ])('%s costs %p global credits a poll', (id, credits) => {
    expect(ADAPTERS.find((adapter) => adapter.id === id)?.paidPoll).toEqual({
      credits,
      pool: 'global',
    });
  });
});
