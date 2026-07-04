import { Module } from '@nestjs/common';

import { SourcesModule } from '@/modules/sources/sources.module';

import { SubscriptionsService } from './subscriptions.service';
import { WatchService } from './watch.service';

@Module({
  // NOTE: entities/ define the schema (see the migration); TypeOrmModule.forFeature +
  // repository injection arrive in 3.3 when the service moves off the in-memory store.
  imports: [SourcesModule],
  providers: [SubscriptionsService, WatchService],
  exports: [SubscriptionsService, WatchService],
})
export class SubscriptionsModule {}
