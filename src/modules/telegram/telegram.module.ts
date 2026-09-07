import { Module } from '@nestjs/common';

import { MetricsModule } from '@/metrics/metrics.module';
import { SourcesModule } from '@/modules/sources/sources.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';

import { CheckHandlers } from './check.handlers';
import { TelegramHandlers } from './telegram.handlers';
import { TelegramService } from './telegram.service';
import { WatchScheduler } from './watch.scheduler';
import { WatchStatus } from './watch.status';

/**
 * Two subsystems share this module: `telegram.*` is the bot conversation, `watch.*` is the
 * scheduled run. The prefix names the concern that OWNS the file, not its only caller — the
 * rule, with the shared cases, is docs/llm/rules/architecture.md § Module Rules.
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
