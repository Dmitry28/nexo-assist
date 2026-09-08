import type { SourceId } from '@/modules/sources/source-adapter';

// Min polls of a source in one run before "all failed" is treated as a source-wide outage
// (below this, a single bad URL would raise a false alarm).
// TODO [M]: a source with fewer subscriptions than this threshold can never raise the outage
// alert, yet its subscriptions are still auto-paused — an alerting hole exactly where a new
// source starts. Scale the threshold to the source's subscription count instead of a flat 3.
export const SOURCE_FAILURE_MIN_POLLS = 3;

// Per-source poll counters for the source-outage alert.
type SourceStats = { attempts: number; failures: number };

/**
 * Per-run accumulator of poll outcomes per source, and the source-outage rule over them.
 * NOTE: not a provider — one instance per watch run, so counters never leak between runs.
 */
export class SourceTally {
  private readonly stats = new Map<SourceId, SourceStats>();

  record({ source, failed }: { source: SourceId; failed: boolean }): void {
    const tally = this.stats.get(source) ?? { attempts: 0, failures: 0 };
    tally.attempts += 1;
    if (failed) tally.failures += 1;
    this.stats.set(source, tally);
  }

  /** Sources whose polls ALL failed this run, with enough polls to rule out one bad URL. */
  failedSources(): Array<{ source: SourceId; attempts: number }> {
    const failed: Array<{ source: SourceId; attempts: number }> = [];
    for (const [source, { attempts, failures }] of this.stats) {
      if (attempts >= SOURCE_FAILURE_MIN_POLLS && failures === attempts) {
        failed.push({ source, attempts });
      }
    }
    return failed;
  }
}
