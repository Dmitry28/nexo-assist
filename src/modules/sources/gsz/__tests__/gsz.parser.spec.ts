import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { extractPage } from '../gsz.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-10-19T12:00:00Z');

describe('extractPage', () => {
  const { listings, next } = extractPage(fixture('gsz-search.html'), 1, NOW);

  it('reads every card and sees the next page in the pager', () => {
    expect(listings).toHaveLength(3);
    expect(next).toBe(true);
  });

  // «Обновлено 1 дней назад» (the site's own wording) on the card, against the fixed NOW.
  it('dates a vacancy by its relative «updated» text', () => {
    expect(listings[0].listTime).toBe('2026-10-18T12:00:00.000Z');
  });

  it('leaves the time empty when the card has no readable «… назад»', () => {
    const html = fixture('gsz-search.html').replace(/Обновлено[^<]*/g, 'Обновлено недавно');

    expect(extractPage(html, 1, NOW).listings[0].listTime).toBe('');
  });

  it('maps a vacancy: the title uuid as id, salary as price text, employer as seller', () => {
    expect(listings[0]).toMatchObject({
      externalId: '18176cc3-809d-40b6-88b3-fae880de98ed',
      link: 'https://gsz.gov.by/registration/vacancy/18176cc3-809d-40b6-88b3-fae880de98ed/',
      title: 'Агроном (заместитель)',
      priceText: '1600 – 1800 руб.',
      seller: 'Филиал "Дубно" открытого акционерного общества "Агрокомбинат"Скидельский"',
      address: 'р-н Мостовский, с/с Дубненский, д. Дубно, Октябрьская, 8',
      images: [],
      details: [{ label: 'Ставка', value: '1' }],
    });
  });

  it('skips a block that links to no vacancy', () => {
    const html = fixture('gsz-search.html').replace(
      '/registration/vacancy/',
      '/registration/elsewhere/',
    );

    expect(extractPage(html, 1, NOW).listings).toHaveLength(2);
  });

  it('says so when a vacancy has no salary', () => {
    const html = fixture('gsz-search.html').replace(/<span class="salary">[\s\S]*?<\/span>/, '');

    expect(extractPage(html, 1, NOW).listings[0].priceText).toBe('зарплата не указана');
  });

  it('reports no later page when the pager has no link to it', () => {
    expect(extractPage(fixture('gsz-search.html'), 13, NOW).next).toBe(false);
  });

  it('reads the «nothing found» page as an empty search', () => {
    expect(extractPage(fixture('gsz-empty.html'), 1, NOW)).toEqual({
      listings: [],
      next: false,
    });
  });

  it('throws on a page with neither cards nor that message — a redesign, not an empty search', () => {
    expect(() => extractPage('<html><body>Доступ ограничен</body></html>', 1, NOW)).toThrow(
      SourceUnavailableError,
    );
  });
});
