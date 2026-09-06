import { Injectable } from '@nestjs/common';

/**
 * Shared run state for the watch loop: the scheduler and the handlers both read it and both
 * claim/release the polling slot. Standalone (no deps) so they can share it without a DI cycle —
 * the scheduler depends on TelegramService which depends on TelegramHandlers, so handlers can't
 * inject the scheduler directly.
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
}
