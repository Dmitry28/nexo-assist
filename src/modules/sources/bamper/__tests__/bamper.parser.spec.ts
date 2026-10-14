import { readFileSync } from 'fs';
import { join } from 'path';

import { PROTECTION, SEARCH_PATH, parsePage } from '../bamper.parser';

const fixture = readFileSync(join(__dirname, 'fixtures', 'bamper-search.html'), 'utf8');

describe('bamper parsePage', () => {
  const { listings } = parsePage(fixture);

  it('reads every offer card by its photo link', () => {
    expect(listings.map((l) => l.externalId)).toEqual([
      '18164-178991203',
      '305521-168610926',
      '153546-177618866',
    ]);
    expect(listings[0]).toMatchObject({
      link: 'https://bamper.by/zapchast_bamper-zadniy/18164-178991203/',
      title: 'Бампер задний к Volkswagen Atlas Cross Sport, 2025 г.',
      priceByn: 5117,
      address: 'Минск',
      listTime: '',
      // The photo, not the favourite icon that comes first in the card.
      images: ['https://bamper.by/upload/lk/349/349eacc453a1eeaedfcd56705f700aa5.jpg'],
      details: [
        { label: 'Авто', value: '2.0 л, бензин, АКПП' },
        { label: 'Рейтинг продавца', value: '87%' },
      ],
    });
  });

  it('keeps the seller notes, and no rating for an unrated seller', () => {
    expect(listings[1].description).toBe('Оригинал США ,R-Line, хорошее состояние, комплектный');
    expect(listings[2].details).toEqual([{ label: 'Авто', value: '2.0 л' }]);
  });
});

describe('bamper PROTECTION.usable', () => {
  it('tells the search page, empty or not, from the Cloudflare challenge', () => {
    expect(PROTECTION.usable(fixture)).toBe(true);
    expect(PROTECTION.usable('<title>Just a moment...</title>')).toBe(false);
  });
});

describe('bamper SEARCH_PATH', () => {
  it.each(['/zchbu/zapchast_bamper-zadniy/marka_volkswagen', '/zchbu/marka_volkswagen'])(
    'takes the parts search %s',
    (path) => expect(SEARCH_PATH.test(path)).toBe(true),
  );

  it.each(['/zchbu', '/zapchast_bamper-zadniy/18164-178991203'])('refuses %s', (path) =>
    expect(SEARCH_PATH.test(path)).toBe(false),
  );
});
