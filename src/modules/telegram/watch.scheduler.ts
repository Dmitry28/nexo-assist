import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { newListingsDigest } from './telegram.format';
import { TelegramService } from './telegram.service';

const JOB_NAME = 'daily-watch';

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
    // NOTE: skip under tests, and when the bot is disabled (no token) — nothing to
    // deliver, and marking listings seen on a no-op notify would silently drop them.
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
    for (const sub of this.subscriptions.listAll()) {
      try {
        // A failed on-subscribe baseline retries here — seed silently, don't flood.
        if (!sub.baselinedAt) {
          await this.watch.baseline(sub);
          continue;
        }
        const fresh = await this.watch.check(sub);
        if (fresh.length > 0) {
          const { text, delivered } = newListingsDigest(fresh);
          // TODO Phase 4: on a 403 (user blocked the bot), pause that user's subscriptions [M].
          await this.telegram.notify(sub.telegramUserId, text);
          this.watch.markSeen(sub, delivered);
        }
      } catch (err) {
        // NOTE: isolate failures — one bad subscription must not skip the rest.
        this.logger.error({ err }, `Watch failed for subscription ${sub.id}`);
      }
    }
  }
}
