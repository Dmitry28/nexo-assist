import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { enrich, load, parsePage } from '../gcn.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('gcn', () => {
  describe('load', () => {
    // The page carries only the grid's settings and a rotating nonce; the lots come from a
    // separate request rebuilt from them every poll.
    it('requests the grid with the settings and nonce the page carries', async () => {
      const get = jest
        .fn<Promise<string>, [string]>()
        .mockResolvedValueOnce(fixture('gcn-search.1.html'))
        .mockResolvedValueOnce('grid');

      await expect(load('https://gcn.by/zemelnye-uchastki/x/', get)).resolves.toBe('grid');

      const grid = new URL(get.mock.calls[1][0]);
      expect(grid.pathname).toBe('/wp-admin/admin-ajax.php');
      expect(grid.searchParams.get('action')).toBe('vc_get_vc_grid_data');
      expect(grid.searchParams.get('_vcnonce')).toBe('9547f152ad');
      expect(grid.searchParams.get('data[page_id]')).toBe('353');
    });

    it('throws when the page has no grid', async () => {
      await expect(
        load('https://gcn.by/x/', () => Promise.resolve('<html></html>')),
      ).rejects.toThrow(SourceUnavailableError);
    });
  });

  describe('parsePage', () => {
    const { listings } = parsePage(fixture('gcn-search.2.html'));

    it('maps a lot: its path as id, an https link, address, plot size, cadastral number, map', () => {
      expect(listings).toHaveLength(3);
      expect(listings[0]).toMatchObject({
        externalId: '/properties/zemelnyj-uchastok-po-ul-peschanoj-2/',
        link: 'https://gcn.by/properties/zemelnyj-uchastok-po-ul-peschanoj-2/',
        title: 'Земельный участок по ул. Песчаной, 2',
        address: 'г. Гродно, ул. Песчаная, 2',
        details: [
          { label: 'Участок', value: '0,099 га' },
          { label: 'Кадастровый номер', value: '440100000002013056' },
        ],
      });
      expect(listings[0].images[0]).toMatch(/^https:\/\/gcn\.by\/wp-content\//);
    });

    // A rejected nonce answers 200 with «0» — no grid at all; an empty grid is no auctions now.
    it('throws on a refused grid request, reads an empty grid as no lots', () => {
      expect(() => parsePage('0')).toThrow(SourceUnavailableError);
      expect(parsePage('<div class="vc_grid"></div>')).toEqual({ listings: [] });
    });
  });

  describe('enrich', () => {
    it('adds the starting price and the utilities line from the live lot page', async () => {
      const [lot] = parsePage(fixture('gcn-search.2.html')).listings;

      const enriched = await enrich(lot, () => Promise.resolve(fixture('gcn-item.html')));

      expect(enriched.priceByn).toBe(34294);
      expect(enriched.details).toContainEqual({
        label: 'Коммуникации',
        value: expect.stringMatching(/^Имеется возможность подключения к сетям/),
      });
    });

    it.each(['34 294,00 руб.', '34 294,00 бел. руб.', '34 294 BYN'])(
      'reads the price «%s»',
      async (price) => {
        const [lot] = parsePage(fixture('gcn-search.2.html')).listings;

        const enriched = await enrich(lot, () =>
          Promise.resolve(`<body>Начальная цена: ${price}</body>`),
        );

        expect(enriched.priceByn).toBe(34294);
      },
    );
  });
});
