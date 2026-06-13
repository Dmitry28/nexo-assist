import { Module } from '@nestjs/common';

import { KufarModule } from '@/modules/kufar/kufar.module';

import { SubscriptionsService } from './subscriptions.service';
import { WatchService } from './watch.service';

@Module({
  imports: [KufarModule],
  providers: [SubscriptionsService, WatchService],
  exports: [SubscriptionsService, WatchService],
})
export class SubscriptionsModule {}
