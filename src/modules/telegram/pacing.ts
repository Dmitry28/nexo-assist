import type { AppConfig } from '@/config/configuration';

/**
 * Timing for the watch flow: sleeping, and the paced delay between source polls that the
 * daily run and the manual /check share.
 *
 * NOTE: its own leaf module on purpose — living in watch.scheduler.ts it closed an import
 * cycle that stopped the app from booting. The full account and the guard against a repeat:
 * src/__tests__/di-wiring.spec.ts.
 */

/** Sleep for `ms`. Lives here rather than at each call site: this is the timing module. */
export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Base delay plus a random 0..jitter, in ms — so we don't hammer a source. */
export function jitteredDelay({
  minMs,
  jitterMs,
  random = Math.random,
}: {
  minMs: number;
  jitterMs: number;
  random?: () => number;
}): number {
  return minMs + Math.floor(random() * (jitterMs + 1));
}

// TODO [L]: the timer is not cleared on shutdown, so a /check mid-pace delays a graceful stop
// by up to one interval. Bounded and harmless today; revisit if shutdown time starts to matter.
/** Wait one paced interval, as configured. */
export function pace(appConfig: AppConfig): Promise<void> {
  const ms = jitteredDelay({
    minMs: appConfig.watchMinDelayMs,
    jitterMs: appConfig.watchJitterMs,
  });
  return wait(ms);
}
