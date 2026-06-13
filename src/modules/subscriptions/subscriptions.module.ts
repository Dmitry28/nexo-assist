import { Module } from '@nestjs/common';

import { SourcesModule } from '@/modules/sources/sources.module';

import { SubscriptionsService } from './subscriptions.service';
import { WatchService } from './watch.service';

@Module({
  imports: [SourcesModule],
  providers: [SubscriptionsService, WatchService],
  exports: [SubscriptionsService, WatchService],
})
export class SubscriptionsModule {}
