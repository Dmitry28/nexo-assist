const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Narrow an untyped `__NEXT_DATA__` branch to an object, or undefined. The blob is untyped JSON,
 * so walking it is the one place a cast would otherwise appear on every step (see typescript.md);
 * this checks instead of asserting, so a changed layout yields undefined rather than a crash.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * Narrow an untyped `__NEXT_DATA__` branch to an array of `T`, or undefined. The element type is
 * the caller's promise, not a check — only the array-ness is verified, which is what keeps a
 * layout change from reaching `.map`/`.find` as "x is not a function".
 */
export function asArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

/**
 * Narrow an untyped `__NEXT_DATA__` branch to usable text, or undefined. Trimmed, and blank
 * counts as absent: sources spell "no value" as a missing key, null, '' and '   ' alike, and a
 * `Listing` field carrying whitespace is a blank line in the digest.
 */
export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Narrow an untyped `__NEXT_DATA__` branch to a finite number, or undefined. Strings are parsed
 * because kufar spells its numeric parameters as strings ("12.5") where realt sends numbers.
 *
 * Strict on purpose: "12 сот." yields undefined rather than 12. A unit inside the value means
 * the field is not what we assumed, and a wrong number in a card reads as fact.
 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = asText(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * As `asNumber`, but zero and negatives count as absent — which is how these sources spell "not
 * filled in" for an area, a room count or a year. Fields where zero is a real value (a mileage,
 * say) take `asNumber` instead; the adapter knows which it is.
 */
export function asPositiveNumber(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

const NEXT_DATA_OPEN = '<script id="__NEXT_DATA__" type="application/json">';

/**
 * Parse the `__NEXT_DATA__` JSON blob embedded in an SSR page, or null on any failure.
 * NOTE: positional slice, not regex — the JSON contains '<' (titles/descriptions).
 */
export function parseNextData(html: string): Record<string, unknown> | null {
  const start = html.indexOf(NEXT_DATA_OPEN);
  if (start === -1) return null;
  const from = start + NEXT_DATA_OPEN.length;
  const end = html.indexOf('</script>', from);
  if (end === -1) return null;

  try {
    // A blob that parses to a number or an array is not a page — asRecord rejects it and this
    // returns null, which is what every caller already handles.
    return asRecord(JSON.parse(html.slice(from, end))) ?? null;
  } catch {
    return null;
  }
}
