import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GrammyError } from 'grammy';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import type { Subscription } from '@/modules/subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { newListingsDigest } from './telegram.format';
import { TelegramService } from './telegram.service';

const JOB_NAME = 'daily-watch';

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
      if (await this.deliverFresh(sub)) {
        blockedUsers.add(sub.userId); // record first, so a failed pause still skips the rest
        await this.pauseUser(sub.userId);
      }
    }
  }

  /** Poll one subscription and deliver its fresh listings. Returns true if the user blocked us. */
  private async deliverFresh(sub: Subscription): Promise<boolean> {
    try {
      const outcome = await this.watch.poll(sub);
      // A pending baseline was just seeded silently — deliver only fresh listings.
      if (outcome.kind !== 'fresh') return false;
      const { text, delivered } = newListingsDigest(outcome.listings);
      await this.telegram.notify(sub.user.telegramId, text);
      await this.watch.markSeen(sub, delivered);
    } catch (err) {
      if (isBotBlocked(err)) return true;
      // Isolate failures — one bad subscription must not skip the rest.
      this.logger.error({ err }, `Watch failed for subscription ${sub.id}`);
    }
    return false;
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
