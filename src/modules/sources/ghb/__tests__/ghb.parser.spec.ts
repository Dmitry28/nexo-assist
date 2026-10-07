import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { parsePage } from '../ghb.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/ghb-search.html'), 'utf8');

describe('ghb parsePage', () => {
  const { listings } = parsePage(fixture);
  const byId = new Map(listings.map((l) => [l.externalId, l]));

  // Live: three path kinds, one object linked twice, hrefs mixing http/https and www.
  it('reads every object once, keyed by its path', () => {
    expect([...byId.keys()]).toEqual(
      expect.arrayContaining(['nedvizhimost-dogovor/9291', 'apartments/7782', 'nedvizhimost/8760']),
    );
    expect(listings.filter((l) => l.externalId === 'nedvizhimost/8760')).toHaveLength(1);
    expect(byId.get('apartments/7782')?.link).toBe(
      'https://ghb.by/ru/construction/apartments/7782/',
    );
  });

  it('prices per m² from the table cells, the sales line and the kind', () => {
    expect(byId.get('nedvizhimost-dogovor/9291')).toMatchObject({
      priceText: '2 200 – 2 600 руб./м²',
      listTime: '',
      details: [
        { label: 'Тип', value: 'Жильё' },
        { label: 'Продажи', value: 'Онлайн регистрация проходила 01.10.2026г.' },
      ],
    });
    expect(byId.get('nedvizhimost/8760')?.details[0]).toEqual({ label: 'Тип', value: 'Офисы' });
  });

  // An office table also lists each unit's total cost («98 824,87») — not a price per m².
  it('reads only per-m² cells, not a unit’s total cost', () => {
    const html =
      '<table><tr><td><h3><a href="/ru/construction/nedvizhimost/1/">Офис</a></h3>' +
      '<table><tr><td>2 950</td><td>98 824,87</td></tr></table></td></tr></table>';

    expect(parsePage(html).listings[0].priceText).toBe('2 950 руб./м²');
  });

  it('throws on a page with no objects — a layout change, not an empty list', () => {
    expect(() => parsePage('<html><body>maintenance</body></html>')).toThrow(
      SourceUnavailableError,
    );
  });
});
