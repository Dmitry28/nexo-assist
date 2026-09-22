import { Injectable } from '@nestjs/common';

import type { SourceId } from '@/modules/sources/source-adapter';

import type { SourceOutage } from './source-tally';

/**
 * Runs a source stays down before the alert is repeated.
 *
 * The first run says it; after that the owner already knows, and a daily cron would otherwise
 * send the same line every morning until the fix lands — which is how an alert channel becomes
 * something nobody reads. Seven runs is a weekly reminder at the current schedule.
 */
export const OUTAGE_REMINDER_RUNS = 7;

/** What to tell the owner about a source this run, if anything. */
export type SourceSignal =
  | { kind: 'down'; source: SourceId; attempts: number }
  | { kind: 'still-down'; source: SourceId; runs: number }
  | { kind: 'recovered'; source: SourceId; runs: number };

/**
 * Which sources are known to be down, across runs — the memory `SourceTally` deliberately lacks.
 *
 * In memory, like the polling slot: a restart forgets that a source was down. Three consequences,
 * all accepted: the next run reports the outage as new, a recovery that happened during the
 * restart is never announced, and — the one that actually costs something — a long outage that
 * spans deploys re-sends the initial alert each time and never reaches the weekly reminder. On a
 * daily cron with a deploy or two a week that is the common case, not the rare one. Still not
 * worth a table for two numbers: the alert stays roughly as noisy as deploys are frequent, and
 * the moment that stops being true, the fix is a `source_health` row, not more memory.
 */
@Injectable()
export class SourceHealth {
  private readonly downFor = new Map<SourceId, number>();

  /**
   * Fold this run's verdicts into what we already knew, and return what is worth saying.
   *
   * `down` are the sources whose every poll failed often enough to mean it; `succeeded` are those
   * that answered at least once. A source in neither — no subscriptions this run, or too few
   * polls to judge — keeps whatever state it had and says nothing. Recovery needs an answer, not
   * merely the absence of a verdict: a still-broken source can drop below the outage threshold.
   */
  update({ down, succeeded }: { down: SourceOutage[]; succeeded: SourceId[] }): SourceSignal[] {
    const signals: SourceSignal[] = [];

    for (const { source, attempts } of down) {
      const runs = (this.downFor.get(source) ?? 0) + 1;
      this.downFor.set(source, runs);
      if (runs === 1) signals.push({ kind: 'down', source, attempts });
      // Counted from the first alert rather than from zero: the reminder is due a week after the
      // owner was told, not a week after the outage minus the run that reported it.
      else if ((runs - 1) % OUTAGE_REMINDER_RUNS === 0) {
        signals.push({ kind: 'still-down', source, runs });
      }
    }

    for (const source of succeeded) {
      const runs = this.downFor.get(source);
      if (runs === undefined) continue;
      this.downFor.delete(source);
      signals.push({ kind: 'recovered', source, runs });
    }
    return signals;
  }
}
