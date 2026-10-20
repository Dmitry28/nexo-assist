import { makeListing } from '@/__tests__/helpers/listing';

import { LOT_LABELS, matchesLot, missingFact, startCode, startText } from '../auction-lot';

const lot = (odometer?: string, engine?: string, start?: string) =>
  makeListing(1, {
    details: [
      ...(odometer === undefined ? [] : [{ label: LOT_LABELS.odometer, value: odometer }]),
      ...(engine === undefined ? [] : [{ label: LOT_LABELS.engine, value: engine }]),
      ...(start === undefined ? [] : [{ label: LOT_LABELS.start, value: start }]),
    ],
  });

describe('startCode', () => {
  it.each([
    ['Run & Drive', 'run-and-drive'],
    ['Run &amp; Drive', 'run-and-drive'],
    ['run-and-drive', 'run-and-drive'],
    ['RUNS AND DRIVES', 'run-and-drive'],
    ['ENHANCED VEHICLES', undefined],
    ['Starts', 'starts'],
    ['ENGINE START PROGRAM', 'starts'],
    ['Stationary', 'stationary'],
    ['DOES NOT START', undefined],
    ['NON-STARTER', undefined],
    ['Buy Now', undefined],
  ])('%s → %s', (text, code) => {
    expect(startCode(text)).toBe(code);
  });

  it('spells every auction the same on a card', () => {
    expect(startText('RUNS AND DRIVES')).toBe(startText('Run & Drive'));
  });
});

describe('matchesLot', () => {
  const filter = { odometer: { to: 60000 }, engine: { to: 2 }, start: 'run-and-drive' as const };

  it.each([
    ['49,519 mi', '2.0L I-4 DI', 'Run and Drive', true],
    ['64,533 mi', '2.0L I-4 DI', 'Run and Drive', false], // over the odometer bound
    ['49,519 mi', '3.6L V-6 DI', 'Run and Drive', false], // a bigger engine
    ['49,519 mi', '2.0L  4', 'Starts', false],
    [undefined, '2.0L  4', 'Run and Drive', false], // a lot that does not say fails
    ['49,519 mi', 'Electric', 'Run and Drive', false], // no litres to compare
  ])('%s · %s · %s → %s', (odometer, engine, start, expected) => {
    expect(matchesLot(lot(odometer, engine, start), filter)).toBe(expected);
  });

  it('passes everything when nothing is asked', () => {
    expect(matchesLot(lot(), {})).toBe(true);
  });
});

describe('missingFact', () => {
  it('names a needed fact no lot carries, and nothing when one does', () => {
    const filter = { engine: { to: 2 }, start: 'run-and-drive' as const };
    expect(missingFact([lot('1 mi', undefined, 'Starts')], filter)).toBe(LOT_LABELS.engine);
    expect(missingFact([lot(undefined, '2.0L', 'Starts'), lot()], filter)).toBeUndefined();
    expect(missingFact([lot('1 mi', '2.0L')], filter)).toBeUndefined(); // no badge proves nothing
  });
});
