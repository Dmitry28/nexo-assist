import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { extractPage } from '../gsz.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-10-06T12:00:00Z');

describe('extractPage', () => {
  const { listings, hasMore } = extractPage(fixture('gsz-search.html'), 1, NOW);

  it('reads every card and sees the next page in the pager', () => {
    expect(listings).toHaveLength(3);
    expect(hasMore).toBe(true);
  });

  // «Обновлено 5 часов назад» on the card, against the fixed NOW.
  it('dates a vacancy by its relative «updated» text', () => {
    expect(listings[0].listTime).toBe('2026-10-06T07:00:00.000Z');
  });

  it('leaves the time empty when the card has no readable «… назад»', () => {
    const html = fixture('gsz-search.html').replace(/Обновлено[^<]*/g, 'Обновлено недавно');

    expect(extractPage(html, 1, NOW).listings[0].listTime).toBe('');
  });

  it('maps a vacancy: the title uuid as id, salary as price text, employer as seller', () => {
    expect(listings[0]).toMatchObject({
      externalId: 'c4842bdc-e9ed-4ff1-b91a-afd02d105363',
      title: 'Продавец',
      priceText: '1200 – 1500 руб.',
      seller: 'Гродненское облпотребобщество',
      address: 'обл. Гродненская, р-н Мостовский, г. Мосты, 30 Лет ВЛКСМ, 1',
      images: [],
      details: [{ label: 'Ставка', value: '1,0' }],
    });
  });

  // Measured: the detail URL without `?source=search` answers 500.
  it('keeps the query on the link', () => {
    expect(listings[0].link).toBe(
      'https://gsz.gov.by/registration/employer/vacancy/c4842bdc-e9ed-4ff1-b91a-afd02d105363/detail-public/?source=search',
    );
  });

  it('skips a block that links to no vacancy', () => {
    const html = fixture('gsz-search.html').replace('/detail-public/', '/elsewhere/');

    expect(extractPage(html, 1, NOW).listings).toHaveLength(2);
  });

  it('says so when a vacancy has no salary', () => {
    const html = fixture('gsz-search.html').replace(/<span class="salary">[\s\S]*?<\/span>/, '');

    expect(extractPage(html, 1, NOW).listings[0].priceText).toBe('зарплата не указана');
  });

  it('reports no later page when the pager has no link to it', () => {
    expect(extractPage(fixture('gsz-search.html'), 13, NOW).hasMore).toBe(false);
  });

  it('reads the «nothing found» page as an empty search', () => {
    expect(extractPage(fixture('gsz-empty.html'), 1, NOW)).toEqual({
      listings: [],
      hasMore: false,
    });
  });

  it('throws on a page with neither cards nor that message — a redesign, not an empty search', () => {
    expect(() => extractPage('<html><body>Доступ ограничен</body></html>', 1, NOW)).toThrow(
      SourceUnavailableError,
    );
  });
});
