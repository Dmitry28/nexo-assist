import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GrammyError } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { Listing } from '@/modules/sources/source-adapter';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import type { PollOutcome } from '@/modules/subscriptions/watch.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { deadSubscriptionNotice, newListingsDigest } from './telegram.format';
import { TelegramService } from './telegram.service';

const JOB_NAME = 'daily-watch';

// Consecutive failed polls before a subscription is treated as dead: warn the user, auto-pause.
export const MAX_CONSECUTIVE_FAILURES = 5;

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
  ) {}

  onModuleInit(): void {
    // NOTE: skip under tests, and when the bot is disabled (no token) — polling
    // would fetch sources only to fail on delivery (notify throws without a bot).
    if (this.appConfig.isTest || !this.appConfig.telegramBotToken) return;

    const job = new CronJob(this.appConfig.watchCron, () => void this.runDaily());
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
    for (const [i, sub] of subs.entries()) {
      if (blockedUsers.has(sub.userId)) continue;
      // Pace between polls (not before the first) so sources aren't hit back-to-back.
      if (i > 0) await this.pace();
      try {
        if (await this.processSubscription(sub)) {
          blockedUsers.add(sub.userId); // record first, so a failed pause still skips the rest
          await this.pauseUser(sub.userId);
        }
      } catch (err) {
        // Isolation boundary — a subscription's bookkeeping write must not break the run.
        this.logger.error({ err }, `Subscription ${sub.id} processing failed`);
      }
    }
  }

  /** Poll, then deliver fresh listings. Returns true if the user blocked us. */
  private async processSubscription(sub: Subscription): Promise<boolean> {
    // The dead-link streak tracks POLL (source) failures only — delivery errors below
    // are a separate concern and must not count toward it.
    let outcome: PollOutcome;
    try {
      outcome = await this.watch.poll(sub);
    } catch (err) {
      this.logger.error({ err }, `Watch failed for subscription ${sub.id}`);
      await this.recordFailure(sub);
      return false;
    }
    // Successful poll — clear any prior failure streak so a dead-link pause needs N in a row.
    if (sub.consecutiveFailures > 0) await this.subscriptions.resetFailures(sub.id);
    // A pending baseline was just seeded silently — deliver only fresh listings.
    if (outcome.kind !== 'fresh') return false;
    return this.deliverFresh(sub, outcome.listings);
  }

  /** Send the fresh digest. Returns true if the user blocked us; other send failures are
   *  logged and retried next run (markSeen only after a successful send). */
  private async deliverFresh(sub: Subscription, listings: Listing[]): Promise<boolean> {
    try {
      const { text, delivered } = newListingsDigest(listings);
      await this.telegram.notify(sub.user.telegramId, text);
      await this.watch.markSeen(sub, delivered);
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
    this.logger.log(
      `Paused dead subscription ${sub.id} after ${MAX_CONSECUTIVE_FAILURES} failures`,
    );
    await this.telegram
      .notify(sub.user.telegramId, deadSubscriptionNotice({ source: sub.source, url: sub.url }))
      .catch((err: unknown) => this.logger.warn({ err }, `Dead-link notice failed for ${sub.id}`));
  }

  /** Pause a user's subscriptions after a 403; a write failure must not abort the run. */
  private async pauseUser(userId: string): Promise<void> {
    try {
      await this.subscriptions.pauseAllForUser(userId);
      this.logger.log(`Paused subscriptions for user ${userId} — undeliverable (403)`);
    } catch (err) {
      this.logger.error({ err }, `Failed to pause user ${userId} after 403`);
    }
  }

  private pace(): Promise<void> {
    const ms = jitteredDelay(this.appConfig.watchMinDelayMs, this.appConfig.watchJitterMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
