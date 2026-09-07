import { Module } from '@nestjs/common';

import { MetricsModule } from '@/metrics/metrics.module';
import { SourcesModule } from '@/modules/sources/sources.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';

import { CheckHandlers } from './bot/check.handlers';
import { TelegramHandlers } from './bot/telegram.handlers';
import { TelegramService } from './bot/telegram.service';
import { WatchScheduler } from './watch/watch.scheduler';
import { WatchStatus } from './watch/watch.status';

/**
 * Two subsystems share this module, one folder each: `bot/` is the conversation, `watch/` is the
 * scheduled run. The folder names the concern that OWNS the file, not its only caller, and it is
 * not a dependency boundary — imports cross both ways (docs/llm/rules/architecture.md § Module Rules).
 *
 * The run does not belong here — it lives in this module only because that is how the DI cycle
 * was resolved. The split into `modules/watch`: PRODUCT_PLAN.md § Технический бэклог.
 */
@Module({
  imports: [SubscriptionsModule, SourcesModule, MetricsModule],
  providers: [TelegramService, TelegramHandlers, CheckHandlers, WatchScheduler, WatchStatus],
  // No exports — add them only when another module actually injects TelegramService.
})
export class TelegramModule {}
