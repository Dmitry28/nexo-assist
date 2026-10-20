import { Module } from '@nestjs/common';

import { SourceRequestsService } from './source-requests.service';

/** Links to sites we do not support, filed as GitHub issues for the owner to add a parser. */
@Module({
  providers: [SourceRequestsService],
  exports: [SourceRequestsService],
})
export class SourceRequestsModule {}
