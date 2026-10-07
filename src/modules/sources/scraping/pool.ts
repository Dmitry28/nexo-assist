/**
 * `fn` over every item with at most `limit` running at once, results in input order — for the
 * item-page visits a source makes per poll, which must not hammer a small site. `fn` should not
 * throw: one rejection rejects the whole call.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
