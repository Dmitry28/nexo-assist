import { siteName } from '../sources';

describe('siteName', () => {
  it('names a registered source by its site, an unknown id by itself', () => {
    expect(siteName('kufar-travel')).toBe('travel.kufar.by');
    expect(siteName('retired-source')).toBe('retired-source');
  });
});
