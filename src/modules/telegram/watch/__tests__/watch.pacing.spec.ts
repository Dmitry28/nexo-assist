import { makeAppConfig } from '@/__tests__/helpers/app-config';

import { jitteredDelay, pace } from '../watch.pacing';

describe('jitteredDelay', () => {
  it('returns the base with no jitter, and stays within [min, min+jitter]', () => {
    expect(jitteredDelay({ minMs: 2000, jitterMs: 0 })).toBe(2000);
    expect(jitteredDelay({ minMs: 2000, jitterMs: 3000, random: () => 0 })).toBe(2000); // low end
    expect(jitteredDelay({ minMs: 2000, jitterMs: 3000, random: () => 0.999999 })).toBe(5000); // high end
  });
});

// The only reason to pace at all is that kufar already blocks our datacenter IP: a base and a
// jitter read from the wrong config keys would silently change how hard we hit a source, and
// nothing else in the suite would notice — the scheduler's specs set both to zero.
describe('pace', () => {
  // `clearMocks` resets calls but not implementations, so the patched global would otherwise
  // outlive this file's last test.
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('waits exactly the configured base when there is no jitter', async () => {
    jest.useFakeTimers();
    const timeout = jest.spyOn(global, 'setTimeout');

    const waited = pace(makeAppConfig({ watchMinDelayMs: 2000, watchJitterMs: 0 }));
    await jest.advanceTimersByTimeAsync(2000);
    await waited;

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2000);
  });

  it('adds the configured jitter on top, never beyond it', async () => {
    jest.useFakeTimers();
    const timeout = jest.spyOn(global, 'setTimeout');

    const waited = pace(makeAppConfig({ watchMinDelayMs: 2000, watchJitterMs: 3000 }));
    await jest.advanceTimersByTimeAsync(5000);
    await waited;

    // Asserted as a range, not a value: the jitter is random by design. Reading the wrong key
    // for either half lands the delay outside it.
    const [, ms] = timeout.mock.calls[0] as [unknown, number];
    expect(ms).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThanOrEqual(5000);
  });
});
