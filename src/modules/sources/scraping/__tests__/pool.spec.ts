import { mapPool } from '../pool';

describe('mapPool', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapPool([30, 10, 20, 5], 2, async (ms) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running--;
      return ms * 2;
    });

    expect(result).toEqual([60, 20, 40, 10]);
    expect(peak).toBe(2);
  });

  it('handles an empty input', async () => {
    await expect(mapPool([], 2, () => Promise.resolve(1))).resolves.toEqual([]);
  });
});
