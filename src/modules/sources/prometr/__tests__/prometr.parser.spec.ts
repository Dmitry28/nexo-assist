import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { SEARCH_PATH, parsePage } from '../prometr.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/prometr-search.html'), 'utf8');

describe('prometr parsePage', () => {
  const { listings } = parsePage(fixture);

  // The fixture keeps the live page's unclosed price span and a <style> naming the row class.
  it('reads each unit row once, past the malformed markup and the phantom in <style>', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['42526', '42528', '42531']);
  });

  it('maps a unit: its page, price, area, rooms, plan image and the complex', () => {
    expect(listings[0]).toMatchObject({
      link: 'https://prometr.by/newbuild_belarus/grodno/pogorany/dom-2-1_1303/2-komnatnaya-87-64-42526/',
      title: '2-комн., 87.64 м²',
      priceByn: 218210,
      address: 'Жилой комплекс Погораны',
      details: [
        { label: 'Площадь', value: '87.64 м²' },
        { label: 'Комнат', value: '2' },
        { label: 'Цена за м²', value: '2490 BYN' },
      ],
    });
    expect(listings[0].images[0]).toMatch(/^https:\/\/prometr\.by\/upload\//);
  });

  it('reads a complex with nothing for sale as empty — prometr keeps sold-out complexes up', () => {
    expect(parsePage('<h1>ЖК Пример</h1>')).toEqual({ listings: [] });
  });

  // A renamed row class would otherwise read as «sold out» forever.
  it('throws when the unit table is there but no unit reads', () => {
    expect(() =>
      parsePage('<h1>ЖК</h1><div class="flats-in"><div class="flats-in__line">…</div></div>'),
    ).toThrow(SourceUnavailableError);
  });

  it.each([
    ['/newbuild_belarus/grodno/pogorany', true],
    ['/newbuild_belarus/grodno/pogorany/dom-2-1_1303/2-komnatnaya-87-64-42526', false],
  ])('treats %s as a complex page: %p', (path, expected) => {
    expect(SEARCH_PATH.test(path)).toBe(expected);
  });

  it('throws on a page with no complex title — a layout change or a bot-wall', () => {
    expect(() => parsePage('<html>captcha</html>')).toThrow(SourceUnavailableError);
  });
});
