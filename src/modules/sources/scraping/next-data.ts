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
