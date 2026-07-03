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
    return JSON.parse(html.slice(from, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
