import { Injectable } from '@nestjs/common';

/**
 * How long a claimed slot may go unreleased before the next claimant takes it.
 *
 * The arithmetic behind the number: one subscription costs at most ~3.5 minutes — up to 5 s of
 * pacing, five pages at the 30 s fetch timeout, and about a minute of paced sends. A run is
 * sequential, so the worst case is ~3.5 min × active subscriptions: today's couple of dozen
 * leave a fivefold margin, and the threshold starts touching a live run at about a hundred.
 * That is a ceiling, not a target, and the margin shrinks as subscriptions grow — so the run
 * logs how long it took, rather than leaving the arithmetic to someone's memory.
 */
export const POLL_STUCK_AFTER_MS = 6 * 60 * 60 * 1000;

/** What a claim attempt did: took a free slot, found it busy, or took one nobody released. */
type PollClaim = 'started' | 'busy' | 'reclaimed';

/** A claim: what happened, and the key that releases it. `busy` gets no key — it holds nothing. */
export interface PollSlot {
  claim: PollClaim;
  /** Pass back to `finishPolling`. Undefined when the claim was refused. */
  key?: symbol;
}

/**
 * Shared run state for the watch loop. Pollers that write the seen set claim and release the
 * slot; read-only fetches only peek at it (see isPollInProgress). Standalone (no deps) so both
 * sides can share it without a DI cycle — the scheduler depends on TelegramService which depends
 * on TelegramHandlers, so handlers can't inject the scheduler directly.
 */
@Injectable()
export class WatchStatus {
  private _lastRunAt?: Date;
  private pollingSince?: number;
  private pollingKey?: symbol;

  get lastRunAt(): Date | undefined {
    return this._lastRunAt;
  }

  markRun(at: Date): void {
    this._lastRunAt = at;
  }

  /**
   * Claim the polling slot; `busy` when a poll is already in flight.
   *
   * One slot for both pollers on purpose: the daily run and a manual /check hit the same
   * sources from the same IP and write the same seen set, so overlapping them doubles the
   * request rate and races markSeen — one path can mark seen what the other is about to send.
   * Release it in a `finally`.
   */
  tryStartPolling(): PollSlot {
    const since = this.pollingSince;
    // A slot is released in a `finally`, so it outlives its run only when that run hangs.
    // Without the reclaim the bot stops polling for good and says nothing; the caller reports
    // it, because a reclaim is always a bug. A hang here is usually *resumable* rather than
    // eternal — @grammyjs/auto-retry retries a network error indefinitely (PRODUCT_PLAN.md
    // § Технический бэклог) — which is exactly why releasing takes a key.
    const stuck = since !== undefined && Date.now() - since >= POLL_STUCK_AFTER_MS;
    if (since !== undefined && !stuck) return { claim: 'busy' };
    this.pollingSince = Date.now();
    this.pollingKey = Symbol('poll');
    return { claim: stuck ? 'reclaimed' : 'started', key: this.pollingKey };
  }

  /**
   * Release the slot — only if this caller still holds it.
   *
   * The key is what makes a reclaim safe. A hung run keeps a `finally` that will fire whenever
   * its await finally settles, and by then the slot may belong to the run that reclaimed it;
   * releasing it there would free a slot mid-poll and let a third poller race the seen set —
   * the exact overlap this class exists to prevent.
   */
  finishPolling(key?: symbol): void {
    if (key !== undefined && key !== this.pollingKey) return;
    this.pollingSince = undefined;
    this.pollingKey = undefined;
  }

  /**
   * Whether a poll is in flight — for read-only fetches that want to stay off the sources
   * during a run without being able to block one.
   *
   * Deliberately a peek, not a claim: claiming would let anyone who can trigger a read-only
   * fetch cancel the daily run, because runDaily abandons the run when the slot is taken.
   * So the slot is held only by the loops that both poll and write the seen set — the run
   * itself and /check.
   *
   * NOTE: baseline-on-subscribe is the one exception, and not by design: it fetches and writes
   * the seen set outside the slot entirely (see PRODUCT_PLAN.md § Технический бэклог). Making
   * it wait behind a run would break signup, so it is unthrottled for now.
   */
  get isPollInProgress(): boolean {
    // Stale reads as free: a hung run would otherwise refuse every read-only fetch until the
    // next claim comes along — up to a day of «идёт проверка» with nothing actually running.
    return this.pollingSince !== undefined && Date.now() - this.pollingSince < POLL_STUCK_AFTER_MS;
  }
}
