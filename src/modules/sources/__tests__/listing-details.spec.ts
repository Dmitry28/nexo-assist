import { detail, listingDetails } from '../listing-details';

describe('detail', () => {
  it('appends the unit the adapter chose', () => {
    expect(detail('Участок', 12, 'сот.')).toEqual({ label: 'Участок', value: '12 сот.' });
  });

  it('keeps a fractional number as it came — a rounded area is a wrong fact', () => {
    expect(detail('Площадь', 114.6, 'м²')?.value).toBe('114.6 м²');
  });

  it('drops a field the source left unset', () => {
    expect(detail('Комнат', undefined)).toBeUndefined();
  });

  it('drops a blank value — whitespace would render as an empty line', () => {
    expect(detail('Тип', '   ')).toBeUndefined();
  });

  it.each(['Не указано', 'не указан', 'НЕ УКАЗАНА', 'n/a'])(
    'drops the placeholder %s whatever its case',
    (placeholder) => {
      expect(detail('Год постройки', placeholder)).toBeUndefined();
    },
  );
});

describe('listingDetails', () => {
  it('keeps the adapter order and closes the gaps', () => {
    const details = listingDetails(
      detail('Тип', 'Дом'),
      detail('Площадь', undefined, 'м²'),
      detail('Участок', 8, 'сот.'),
    );

    expect(details).toEqual([
      { label: 'Тип', value: 'Дом' },
      { label: 'Участок', value: '8 сот.' },
    ]);
  });

  it('is empty, not absent, when the source filled nothing', () => {
    expect(listingDetails(detail('Комнат', undefined))).toEqual([]);
  });
});
