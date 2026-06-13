import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import type { AppConfig } from '@/config/configuration';
import configuration from '@/config/configuration';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { WatchService } from '@/modules/subscriptions/watch.service';

import { formatNewListings } from './telegram.format';
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
    // NOTE: skip under tests — the cron would fire real fetches and notifications.
    if (this.appConfig.isTest) return;

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
        const fresh = await this.watch.check(sub);
        if (fresh.length > 0) {
          // TODO Phase 4: on a 403 (user blocked the bot), pause that user's subscriptions [M].
          await this.telegram.notify(sub.telegramUserId, formatNewListings(fresh));
          // Mark seen only after a successful send — a failed notify retries next run.
          this.watch.markSeen(sub, fresh);
        }
      } catch (err) {
        // NOTE: isolate failures — one bad subscription must not skip the rest.
        this.logger.error({ err }, `Watch failed for subscription ${sub.id}`);
      }
    }
  }
}
