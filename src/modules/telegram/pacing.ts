import type { AppConfig } from '@/config/configuration';

/**
 * Pacing between source polls — shared by the daily run and the manual /check.
 *
 * NOTE: its own leaf module on purpose — living in watch.scheduler.ts it closed an import
 * cycle that stopped the app from booting. The full account and the guard against a repeat:
 * src/__tests__/di-wiring.spec.ts.
 */

/** Base delay plus a random 0..jitter, in ms — so we don't hammer a source. */
export function jitteredDelay(minMs: number, jitterMs: number, random = Math.random): number {
  return minMs + Math.floor(random() * (jitterMs + 1));
}

// TODO [L]: the timer is not cleared on shutdown, so a /check mid-pace delays a graceful stop
// by up to one interval. Bounded and harmless today; revisit if shutdown time starts to matter.
/** Wait one paced interval, as configured. */
export function pace(appConfig: AppConfig): Promise<void> {
  const ms = jitteredDelay(appConfig.watchMinDelayMs, appConfig.watchJitterMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
