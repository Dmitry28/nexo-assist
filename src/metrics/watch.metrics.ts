import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Gauge } from 'prom-client';

// Product metric names — kept together so the scheduler stays free of metric plumbing.
export const DELIVERIES_TOTAL = 'nexo_deliveries_total';
export const POLL_ERRORS_TOTAL = 'nexo_poll_errors_total';
export const SUBSCRIPTIONS_PAUSED_TOTAL = 'nexo_subscriptions_paused_total';
export const USERS = 'nexo_users';
export const ACTIVE_SUBSCRIPTIONS = 'nexo_active_subscriptions';

/** Why a subscription was auto-paused — a label on SUBSCRIPTIONS_PAUSED_TOTAL. */
export type PauseReason = 'blocked' | 'dead';

/** Thin facade over the product Prometheus metrics — semantic methods, one place for names. */
@Injectable()
export class WatchMetrics {
  constructor(
    @InjectMetric(DELIVERIES_TOTAL) private readonly deliveries: Counter,
    @InjectMetric(POLL_ERRORS_TOTAL) private readonly pollErrors: Counter,
    @InjectMetric(SUBSCRIPTIONS_PAUSED_TOTAL) private readonly paused: Counter,
    @InjectMetric(USERS) private readonly users: Gauge,
    @InjectMetric(ACTIVE_SUBSCRIPTIONS) private readonly activeSubscriptions: Gauge,
  ) {}

  recordDelivery(source: string): void {
    this.deliveries.inc({ source });
  }

  recordPollError(source: string): void {
    this.pollErrors.inc({ source });
  }

  recordPause(reason: PauseReason, count = 1): void {
    this.paused.inc({ reason }, count);
  }

  /** Snapshot of current totals — set once per run. */
  setTotals(users: number, activeSubscriptions: number): void {
    this.users.set(users);
    this.activeSubscriptions.set(activeSubscriptions);
  }
}
