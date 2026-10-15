import { asText } from './next-data';

/** ISO 4217 numeric codes, for sources that key prices by them (realt's `priceRates`). */
export const ISO_NUMERIC = { BYN: '933', USD: '840' } as const;

// Codes a redenomination retired that sites still send: the Belarusian ruble (BYR → BYN, 2016)
// and the Russian one (RUR → RUB, 1998).
const SUPERSEDED: Record<string, string> = { BYR: 'BYN', RUR: 'RUB' };

/** A currency code as ISO 4217 names it today — upper-cased, a retired code mapped to its heir. */
export function asCurrency(value: unknown): string | undefined {
  const code = asText(value)?.toUpperCase();
  return code === undefined ? undefined : (SUPERSEDED[code] ?? code);
}
