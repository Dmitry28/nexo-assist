import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SourcesModule } from '@/modules/sources/sources.module';

import { SourceRequest } from './entities/source-request.entity';
import { SourceRequestsService } from './source-requests.service';

/**
 * Links to sites we do not support: filed as GitHub issues for the owner to add a parser, and the
 * requester told once one ships.
 */
@Module({
  imports: [SourcesModule, TypeOrmModule.forFeature([SourceRequest])],
  providers: [SourceRequestsService],
  exports: [SourceRequestsService],
})
export class SourceRequestsModule {}
