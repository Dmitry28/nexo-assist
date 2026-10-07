import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceUnavailableError } from '../../source-adapter';
import { parsePage } from '../rabota.parser';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const state = (vacancies: unknown[], paging: unknown = null): string =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({
    vacancySearchResult: { vacancies, paging },
  }).replace(/"/g, '&#34;')}</template>`;

describe('parsePage', () => {
  const { listings, next } = parsePage(fixture('rabota-search.html'));

  it('reads the vacancies, drops the promoted one, and sees the next page', () => {
    expect(listings.map((l) => l.externalId)).toEqual(['100000001', '100000002']);
    expect(next).toBe(true);
  });

  it('maps a vacancy: canonical link, salary text, exact time, address and pin', () => {
    expect(listings[0]).toMatchObject({
      link: 'https://rabota.by/vacancy/100000001',
      title: 'Токарь универсал',
      priceText: '3\u00a0000 – 5\u00a0500 руб.',
      listTime: '2026-10-06T23:25:08.995+03:00',
      address: 'Минск, улица Примерная, 1',
      coordinates: { lat: 53.9, lon: 27.56 },
      seller: 'ИП Пример',
      images: [],
    });
  });

  it('says so when a vacancy shows no salary', () => {
    expect(listings[1].priceText).toBe('зарплата не указана');
  });

  it.each([
    [{ from: 1500, currencyCode: 'BYR' }, 'от 1\u00a0500 руб.'],
    [{ to: 900, currencyCode: 'USD' }, 'до 900 $'],
    [{ from: 15, to: 15, currencyCode: 'BYR', mode: 'HOUR' }, '15 руб. в час'],
    [
      { from: 2000, to: 3000, currencyCode: 'RUR', gross: true },
      '2\u00a0000 – 3\u00a0000 ₽, до вычета налогов',
    ],
  ])('words the salary %p as «%s»', (compensation, expected) => {
    const [listing] = parsePage(state([{ vacancyId: 7, compensation }])).listings;

    expect(listing.priceText).toBe(expected);
  });

  it('reports no later page when paging is absent or its next is disabled', () => {
    expect(parsePage(state([{ vacancyId: 7 }])).next).toBe(false);
    expect(parsePage(state([{ vacancyId: 7 }], { next: { disabled: true } })).next).toBe(false);
  });

  it('reads a zero-result search as empty', () => {
    expect(parsePage(fixture('rabota-empty.html'))).toEqual({ listings: [], next: false });
  });

  // The anti-bot page the prototype met in production carries no search state.
  it('throws on a page without the search state — never an empty search', () => {
    expect(() => parsePage('<html><body>captcha</body></html>')).toThrow(SourceUnavailableError);
  });
});
