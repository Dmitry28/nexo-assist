import { Module } from '@nestjs/common';

import { KufarAdapter } from './kufar/kufar.adapter';
import { SourceRegistry } from './source-registry';

@Module({
  providers: [KufarAdapter, SourceRegistry],
  exports: [SourceRegistry],
})
export class SourcesModule {}
