import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GrammyError } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { WatchMetrics } from '@/metrics/watch.metrics';
import type { Listing } from '@/modules/sources/source-adapter';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { PollOutcome } from '@/modules/subscriptions/watch.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { deadSubscriptionNotice, newListingsDigest } from './telegram.format';
import { TelegramService } from './telegram.service';
import { WatchStatus } from './watch.status';

export const JOB_NAME = 'daily-watch';

// Consecutive failed polls before a subscription is treated as dead: warn the user, auto-pause.
export const MAX_CONSECUTIVE_FAILURES = 5;

// Min polls of a source in one run before "all failed" is treated as a source-wide outage
// (below this, a single bad URL would raise a false alarm).
const SOURCE_FAILURE_MIN_POLLS = 3;

// Outcome of processing one subscription — drives the source tally and the 403 pause.
type ProcessResult = 'ok' | 'blocked' | 'poll-failed';

// Per-source poll counters for the source-outage alert.
type SourceStats = { attempts: number; failures: number };

/** Base delay plus a random 0..jitter, in ms — paces polls so we don't hammer a source. */
export function jitteredDelay(minMs: number, jitterMs: number, random = Math.random): number {
  return minMs + Math.floor(random() * (jitterMs + 1));
}

/** A Telegram 403 means delivery is impossible (blocked / deactivated) — pause the user. */
function isBotBlocked(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/** Runs the daily subscription check and pushes new listings to each subscriber. */
@Injectable()
export class WatchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatchScheduler.name);

  constructor(
    @Inject(configuration.KEY) private readonly appConfig: AppConfig,
    private readonly scheduler: SchedulerRegistry,
    private readonly subscriptions: SubscriptionsService,
    private readonly watch: WatchService,
    private readonly telegram: TelegramService,
    private readonly metrics: WatchMetrics,
    private readonly status: WatchStatus,
  ) {}

  onModuleInit(): void {
    // NOTE: skip under tests, and when the bot is disabled (no token) — polling
    // would fetch sources only to fail on delivery (notify throws without a bot).
    if (this.appConfig.isTest || !this.appConfig.telegramBotToken) return;

    // Catch here so a run-wide failure (e.g. the initial listActive() DB call) is logged
    // and skips the run — an unhandled rejection would trip the fatal handler in main.ts
    // and kill the whole bot.
    const job = new CronJob(this.appConfig.watchCron, () => {
      void this.runDaily().catch((err: unknown) => {
        this.logger.error({ err }, 'Daily watch run failed');
      });
    });
    this.scheduler.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Daily watch scheduled: ${this.appConfig.watchCron}`);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('cron', JOB_NAME)) this.scheduler.deleteCronJob(JOB_NAME);
  }

  async runDaily(): Promise<void> {
    const subs = await this.subscriptions.listActive();
    // Users who blocked us this run — skip their remaining subs to avoid re-hitting 403.
    const blockedUsers = new Set<string>();
    // Per-source poll tally — used to alert the admin if a whole source is failing.
    const sourceStats = new Map<string, SourceStats>();
    for (const [i, sub] of subs.entries()) {
      if (blockedUsers.has(sub.userId)) continue;
      // Pace between polls (not before the first) so sources aren't hit back-to-back.
      if (i > 0) await this.pace();
      let result: ProcessResult;
      try {
        result = await this.processSubscription(sub);
      } catch (err) {
        // Isolation boundary — a subscription's bookkeeping write must not break the run.
        this.logger.error({ err }, `Subscription ${sub.id} processing failed`);
        continue;
      }
      this.tallySource(sourceStats, sub.source, result === 'poll-failed');
      if (result === 'blocked') {
        blockedUsers.add(sub.userId); // record first, so a failed pause still skips the rest
        await this.pauseUser(sub.userId);
      }
    }
    await this.recordTotals();
    await this.alertFailedSources(sourceStats);
    this.status.markRun(new Date());
  }

  private tallySource(stats: Map<string, SourceStats>, source: string, failed: boolean): void {
    const s = stats.get(source) ?? { attempts: 0, failures: 0 };
    s.attempts += 1;
    if (failed) s.failures += 1;
    stats.set(source, s);
  }

  /** Alert the admin about any source whose polls all failed this run (likely a broken adapter). */
  private async alertFailedSources(stats: Map<string, SourceStats>): Promise<void> {
    for (const [source, { attempts, failures }] of stats) {
      if (attempts >= SOURCE_FAILURE_MIN_POLLS && failures === attempts) {
        await this.notifyAdmin(
          `🚨 Source "${source}" failed all ${attempts} polls this run — the adapter may be broken.`,
        );
      }
    }
  }

  /** Send an alert to the owner if configured; a failed alert must not affect the run. */
  private async notifyAdmin(text: string): Promise<void> {
    const adminId = this.appConfig.adminTelegramId;
    if (adminId === undefined) return;
    await this.telegram
      .notify(adminId, text)
      .catch((err: unknown) => this.logger.warn({ err }, 'Admin alert failed'));
  }

  /** Snapshot user/subscription gauges once per run; a metrics failure must not fail the run. */
  private async recordTotals(): Promise<void> {
    try {
      const [users, active] = await Promise.all([
        this.subscriptions.countUsers(),
        this.subscriptions.countActive(),
      ]);
      this.metrics.setTotals(users, active);
    } catch (err) {
      this.logger.warn({ err }, 'Failed to record totals');
    }
  }

  /** Poll, then deliver fresh listings. The dead-link streak and the source tally track
   *  POLL (source) failures only — delivery errors are a separate concern. */
  private async processSubscription(sub: Subscription): Promise<ProcessResult> {
    let outcome: PollOutcome;
    try {
      outcome = await this.watch.poll(sub);
    } catch (err) {
      this.logger.error({ err }, `Watch failed for subscription ${sub.id}`);
      this.metrics.recordPollError(sub.source);
      // Guard the bookkeeping so a DB hiccup can't hide a poll failure from the source
      // tally — otherwise a broken adapter + failing write would suppress the outage alert.
      await this.recordFailure(sub).catch((e: unknown) =>
        this.logger.error({ err: e }, `recordFailure failed for ${sub.id}`),
      );
      return 'poll-failed';
    }
    // Successful poll — clear any prior failure streak so a dead-link pause needs N in a row.
    if (sub.consecutiveFailures > 0) await this.subscriptions.resetFailures(sub.id);
    // A pending baseline was just seeded silently — deliver only fresh listings.
    if (outcome.kind !== 'fresh') return 'ok';
    return (await this.deliverFresh(sub, outcome.listings)) ? 'blocked' : 'ok';
  }

  /** Send the fresh digest. Returns true if the user blocked us; other send failures are
   *  logged and retried next run (markSeen only after a successful send). */
  private async deliverFresh(sub: Subscription, listings: Listing[]): Promise<boolean> {
    try {
      const { text, delivered } = newListingsDigest(listings);
      await this.telegram.notify(sub.user.telegramId, text);
      await this.watch.markSeen(sub, delivered);
      this.metrics.recordDelivery(sub.source);
    } catch (err) {
      if (isBotBlocked(err)) return true;
      this.logger.error({ err }, `Delivery failed for subscription ${sub.id}`);
    }
    return false;
  }

  /** Count a failed poll; at MAX_CONSECUTIVE_FAILURES pause the dead sub and warn the user. */
  private async recordFailure(sub: Subscription): Promise<void> {
    await this.subscriptions.bumpFailures(sub.id);
    if (sub.consecutiveFailures + 1 < MAX_CONSECUTIVE_FAILURES) return;
    // Pause first — only tell the user it's paused if the write actually stuck.
    await this.subscriptions.pause(sub.id);
    this.metrics.recordPause('dead');
    this.logger.log(
      `Paused dead subscription ${sub.id} after ${MAX_CONSECUTIVE_FAILURES} failures`,
    );
    await this.telegram
      .notify(sub.user.telegramId, deadSubscriptionNotice({ source: sub.source, url: sub.url }))
      .catch((err: unknown) => this.logger.warn({ err }, `Dead-link notice failed for ${sub.id}`));
    await this.notifyAdmin(
      `⏸ Paused a dead ${sub.source} subscription after ${MAX_CONSECUTIVE_FAILURES} failures.\n${sub.url}`,
    );
  }

  /** Pause a user's subscriptions after a 403; a write failure must not abort the run. */
  private async pauseUser(userId: string): Promise<void> {
    try {
      const paused = await this.subscriptions.pauseAllForUser(userId);
      this.metrics.recordPause('blocked', paused);
      this.logger.log(`Paused ${paused} subscriptions for user ${userId} — undeliverable (403)`);
      await this.notifyAdmin(
        `⏸ Paused ${paused} subscription(s) for user ${userId} — they blocked the bot (403).`,
      );
    } catch (err) {
      this.logger.error({ err }, `Failed to pause user ${userId} after 403`);
    }
  }

  private pace(): Promise<void> {
    const ms = jitteredDelay(this.appConfig.watchMinDelayMs, this.appConfig.watchJitterMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
