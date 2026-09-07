import { Injectable } from '@nestjs/common';

/**
 * Shared run state for the watch loop. Pollers that write the seen set claim and release the
 * slot; read-only fetches only peek at it (see isPollInProgress). Standalone (no deps) so both
 * sides can share it without a DI cycle — the scheduler depends on TelegramService which depends
 * on TelegramHandlers, so handlers can't inject the scheduler directly.
 */
@Injectable()
export class WatchStatus {
  private _lastRunAt?: Date;
  private polling = false;

  get lastRunAt(): Date | undefined {
    return this._lastRunAt;
  }

  markRun(at: Date): void {
    this._lastRunAt = at;
  }

  /**
   * Claim the polling slot; false when a poll is already in flight.
   *
   * One slot for both pollers on purpose: the daily run and a manual /check hit the same
   * sources from the same IP and write the same seen set, so overlapping them doubles the
   * request rate and races markSeen — one path can mark seen what the other is about to send.
   * Release it in a `finally`.
   */
  tryStartPolling(): boolean {
    if (this.polling) return false;
    this.polling = true;
    return true;
  }

  finishPolling(): void {
    this.polling = false;
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
    return this.polling;
  }
}
