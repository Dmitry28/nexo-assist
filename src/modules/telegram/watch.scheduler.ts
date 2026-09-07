import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
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

import type { ReportOp } from './report';
import { reportUserFacing } from './report';
import { SourceTally } from './source-tally';
import { deliverAndMark } from './telegram.deliver';
import { deadSubscriptionNotice } from './telegram.format';
import { TelegramService } from './telegram.service';
import { pace } from './watch.pacing';
import { WatchStatus } from './watch.status';

export const JOB_NAME = 'daily-watch';

// Consecutive failed polls before a subscription is treated as dead: warn the user, auto-pause.
export const MAX_CONSECUTIVE_FAILURES = 5;

// Outcome of processing one subscription — drives the source tally and the 403 pause.
type ProcessResult = 'ok' | 'blocked' | 'poll-failed';

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
    // NOTE: bare captureException on purpose — a whole run failing belongs to no single user.
    const job = new CronJob(this.appConfig.watchCron, () => {
      void this.runDaily().catch((err: unknown) => {
        this.logger.error({ err }, 'Daily watch run failed');
        Sentry.captureException(err);
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
    // Skip rather than queue: whatever is polling covers the same subscriptions, and a
    // WATCH_CRON firing faster than a run lasts would otherwise stack parallel runs.
    // The owner is told, because a warn stays inside the process (PRODUCT_PLAN.md § бэклог).
    if (!this.status.tryStartPolling()) {
      this.logger.warn('Watch run skipped — a poll is already in progress');
      await this.notifyAdmin('⚠️ Суточный прогон пропущен — опрос уже шёл. Проверки не было.');
      return;
    }
    try {
      await this.pollAll();
    } finally {
      this.status.finishPolling();
    }
    // TODO [L]: markRun sits outside the try/finally, so a thrown pollAll leaves /stats showing an
    // old timestamp as «последний прогон» with no failure signal. The value is "last SUCCESSFUL
    // run" — rename it and surface the failed run.
    this.status.markRun(new Date());
  }

  private async pollAll(): Promise<void> {
    const subs = await this.subscriptions.listActive();
    // Users who blocked us this run — skip their remaining subs to avoid re-hitting 403.
    const blockedUsers = new Set<string>();
    // Per-source poll tally — used to alert the admin if a whole source is failing.
    const tally = new SourceTally();
    for (const [i, sub] of subs.entries()) {
      if (blockedUsers.has(sub.userId)) continue;
      // Pace between polls (not before the first) so sources aren't hit back-to-back.
      if (i > 0) await pace(this.appConfig);
      let result: ProcessResult;
      try {
        result = await this.processSubscription(sub);
      } catch (err) {
        // Isolation boundary — a subscription's bookkeeping write must not break the run.
        // NOTE: swallowed on purpose, so it must be reported — otherwise it is invisible.
        this.logger.error({ err }, `Subscription ${sub.id} processing failed`);
        this.report({ err, sub, op: 'process' });
        // TODO [L]: this `continue` skips tally.record, so a throwing subscription never counts
        // toward `attempts` and can push a source below SOURCE_FAILURE_MIN_POLLS, suppressing the
        // outage alert — the same distortion the recordFailure guard below exists to prevent.
        continue;
      }
      tally.record({ source: sub.source, failed: result === 'poll-failed' });
      if (result === 'blocked') {
        blockedUsers.add(sub.userId); // record first, so a failed pause still skips the rest
        await this.pauseUser(sub.userId);
      }
    }
    await this.recordTotals();
    await this.alertFailedSources(tally);
  }

  /** Alert the admin about any source whose polls all failed this run (likely a broken adapter). */
  private async alertFailedSources(tally: SourceTally): Promise<void> {
    for (const { source, attempts } of tally.failedSources()) {
      await this.notifyAdmin(
        `🚨 Источник «${source}»: провалились все опросы в этом прогоне (${attempts}) — возможно, сломан адаптер.`,
      );
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
      this.metrics.setTotals({ users, activeSubscriptions: active });
    } catch (err) {
      // Swallowed so the run still finishes, so it must be reported: without it the
      // user/subscription gauges freeze at their last value and Grafana shows a flat healthy
      // line forever.
      // NOTE: bare captureException on purpose — run-wide metrics belong to no single user.
      this.logger.warn({ err }, 'Failed to record totals');
      Sentry.captureException(err);
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
      // The scheduled run — not /check — is where site outages actually land, so this is the
      // path that has to carry `kind: source`; otherwise that split never shows up in practice.
      this.report({ err, sub, op: 'poll' });
      this.metrics.recordPollError(sub.source);
      // Guard the bookkeeping so a DB hiccup can't hide a poll failure from the source
      // tally — otherwise a broken adapter + failing write would suppress the outage alert.
      await this.recordFailure(sub).catch((e: unknown) => {
        this.logger.error({ err: e }, `recordFailure failed for ${sub.id}`);
        this.report({ err: e, sub, op: 'record-failure' });
      });
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
    const { delivered, error, markSeenError } = await deliverAndMark({
      listings,
      send: (text) => this.telegram.notify(sub.user.telegramId, text),
      markSeen: (items) => this.watch.markSeen(sub, items),
    });

    if (markSeenError) {
      this.logger.error(
        { err: markSeenError },
        `markSeen failed after delivery for subscription ${sub.id}`,
      );
      this.report({
        err: markSeenError,
        sub,
        op: 'mark-seen',
        details: { resending: delivered.length },
      });
    }
    if (delivered.length > 0) this.metrics.recordDelivery(sub.source);

    if (!error) return false;
    // A 403 is an expected state (the user blocked us) handled by pausing them, not a defect —
    // reporting every blocked user would flood Sentry with noise.
    if (isBotBlocked(error)) return true;
    // A send that failed part-way must not pass silently: the user sees a digest numbered
    // "(1/5)" and would wait for four messages that never come.
    this.logger.error({ err: error }, `Delivery failed for subscription ${sub.id}`);
    this.report({ err: error, sub, op: 'deliver', details: { deliveredBefore: delivered.length } });
    return false;
  }

  /** Report a swallowed per-subscription failure — same who/where for every operation. */
  private report({
    err,
    sub,
    op,
    details,
  }: {
    err: unknown;
    sub: Subscription;
    op: ReportOp;
    details?: Record<string, string | number>;
  }): void {
    reportUserFacing(err, {
      userId: sub.user.telegramId,
      action: 'daily',
      url: sub.url,
      op,
      details: { id: sub.id, source: sub.source, ...details },
    });
  }

  /** Count a failed poll; at MAX_CONSECUTIVE_FAILURES pause the dead sub and warn the user. */
  // TODO [M]: purely per-subscription — it never consults the run's source tally, so a broken
  // adapter auto-pauses EVERY subscription of that source and tells each user «Проверьте ссылку»,
  // which is factually wrong, with manual ▶️ recovery per user. alertFailedSources sees the
  // outage but only after the pausing, and is advisory only. Skip the pause on a source outage.
  private async recordFailure(sub: Subscription): Promise<void> {
    await this.subscriptions.bumpFailures(sub.id);
    if (sub.consecutiveFailures + 1 < MAX_CONSECUTIVE_FAILURES) return;
    // Pause first — only tell the user it's paused if the write actually stuck.
    await this.subscriptions.pause(sub.id);
    this.metrics.recordPause('dead');
    this.logger.log(
      `Paused dead subscription ${sub.id} after ${MAX_CONSECUTIVE_FAILURES} failures`,
    );
    // TODO [L]: the notice and the admin alert fan out one message per subscription, so a user at
    // the 50-subscription cap gets 50 near-identical notices in one run and the admin gets 50 too,
    // likely tripping Telegram's per-chat rate limit. Aggregate them per user and per run.
    await this.telegram
      .notify(sub.user.telegramId, deadSubscriptionNotice({ source: sub.source, url: sub.url }))
      .catch((err: unknown) => this.logger.warn({ err }, `Dead-link notice failed for ${sub.id}`));
    await this.notifyAdmin(
      `⏸ Подписка «${sub.source}» на паузе — неудачных опросов подряд: ${MAX_CONSECUTIVE_FAILURES}.\n${sub.url}`,
    );
  }

  /** Pause a user's subscriptions after a 403; a write failure must not abort the run. */
  private async pauseUser(userId: string): Promise<void> {
    try {
      const paused = await this.subscriptions.pauseAllForUser(userId);
      this.metrics.recordPause('blocked', paused);
      this.logger.log(`Paused ${paused} subscriptions for user ${userId} — undeliverable (403)`);
      await this.notifyAdmin(
        `⏸ Поставлено на паузу подписок: ${paused} (пользователь ${userId} заблокировал бота).`,
      );
    } catch (err) {
      this.logger.error({ err }, `Failed to pause user ${userId} after 403`);
      // NOTE: bare on purpose — `userId` here is our internal uuid, not a telegram id. Feeding
      // it to setUser would mix two id spaces and corrupt the affected-user counts.
      Sentry.captureException(err);
    }
  }
}
