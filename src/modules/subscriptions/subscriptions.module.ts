import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SourcesModule } from '@/modules/sources/sources.module';

import { SeenListing } from './entities/seen-listing.entity';
import { Subscription } from './entities/subscription.entity';
import { User } from './entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';
import { WatchService } from './watch.service';

@Module({
  imports: [SourcesModule, TypeOrmModule.forFeature([Subscription, SeenListing, User])],
  providers: [SubscriptionsService, WatchService],
  exports: [SubscriptionsService, WatchService],
})
export class SubscriptionsModule {}
