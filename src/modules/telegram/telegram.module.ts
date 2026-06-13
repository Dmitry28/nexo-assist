import { Module } from '@nestjs/common';

import { SourcesModule } from '@/modules/sources/sources.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';

import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';
import { WatchScheduler } from './watch.scheduler';

@Module({
  imports: [SubscriptionsModule, SourcesModule],
  providers: [TelegramService, TelegramHandlers, WatchScheduler],
  // No exports — add them only when another module actually injects TelegramService.
})
export class TelegramModule {}
