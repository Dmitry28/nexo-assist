import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { parsePage } from '../grodnorik.parser';

const fixture = readFileSync(join(__dirname, 'fixtures/grodnorik-search.html'), 'utf8');

describe('grodnorik parsePage', () => {
  const { listings } = parsePage(fixture);
  const byFile = (part: string) => listings.find((l) => l.externalId.includes(part));

  // Live: the same file linked twice, once by an empty anchor wrapping a separator.
  it('reads each notice file once, the titled anchor winning', () => {
    expect(listings.filter((l) => l.externalId.includes('Putrishkovskij'))).toHaveLength(1);
    expect(byFile('Gnevenschina')).toMatchObject({
      title: expect.stringMatching(/^Извещение о проведении 5 ноября 2026/),
      priceText: 'цена — в извещении',
      listTime: '',
      details: [{ label: 'Аукцион', value: '05.11.2026' }],
    });
  });

  it('names an untitled notice by its file, dated from the file name', () => {
    expect(byFile('31-08-2026-Skidel')).toMatchObject({
      title: 'auktsion 31 08 2026 Skidel',
      details: [{ label: 'Аукцион', value: '31.08.2026' }],
    });
  });

  // The id is the path: the site mixes http/https, which must not re-announce the archive.
  it('keys a notice by its path, whatever scheme the link used', () => {
    const page = (href: string) =>
      parsePage(`<div class="inner_text"><a href="${href}">Извещение</a></div>`).listings[0];

    expect(page('http://grodnorik.gov.by/uploads/files/materialy/OBR/a.pdf').externalId).toBe(
      page('https://grodnorik.gov.by/uploads/files/materialy/OBR/a.pdf').externalId,
    );
  });

  it('throws on a page with no notices', () => {
    expect(() => parsePage('<div class="inner_text">—</div>')).toThrow(SourceUnavailableError);
  });
});
