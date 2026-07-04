import { Module } from '@nestjs/common';

import { MetricsModule } from '@/metrics/metrics.module';
import { SourcesModule } from '@/modules/sources/sources.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';

import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';
import { WatchScheduler } from './watch.scheduler';
import { WatchStatus } from './watch.status';

@Module({
  imports: [SubscriptionsModule, SourcesModule, MetricsModule],
  providers: [TelegramService, TelegramHandlers, WatchScheduler, WatchStatus],
  // No exports — add them only when another module actually injects TelegramService.
})
export class TelegramModule {}
