import { jitteredDelay } from '../watch.pacing';

describe('jitteredDelay', () => {
  it('returns the base with no jitter, and stays within [min, min+jitter]', () => {
    expect(jitteredDelay({ minMs: 2000, jitterMs: 0 })).toBe(2000);
    expect(jitteredDelay({ minMs: 2000, jitterMs: 3000, random: () => 0 })).toBe(2000); // low end
    expect(jitteredDelay({ minMs: 2000, jitterMs: 3000, random: () => 0.999999 })).toBe(5000); // high end
  });
});
