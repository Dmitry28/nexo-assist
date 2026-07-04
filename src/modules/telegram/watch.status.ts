import { Injectable } from '@nestjs/common';

/**
 * Shared run state for the watch loop. Standalone (no deps) so both the scheduler
 * (writer) and the handlers (reader) can use it without a DI cycle — the scheduler
 * depends on TelegramService which depends on TelegramHandlers, so handlers can't
 * inject the scheduler directly.
 */
@Injectable()
export class WatchStatus {
  private _lastRunAt?: Date;

  get lastRunAt(): Date | undefined {
    return this._lastRunAt;
  }

  markRun(at: Date): void {
    this._lastRunAt = at;
  }
}
