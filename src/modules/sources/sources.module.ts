import { Module } from '@nestjs/common';

import { KufarAdapter } from './kufar/kufar.adapter';
import { RealtAdapter } from './realt/realt.adapter';
import { SOURCE_ADAPTERS, SourceRegistry } from './source-registry';

@Module({
  providers: [
    KufarAdapter,
    RealtAdapter,
    // Register a new source by adding its adapter here — SourceRegistry stays untouched.
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (kufar: KufarAdapter, realt: RealtAdapter) => [kufar, realt],
      inject: [KufarAdapter, RealtAdapter],
    },
    SourceRegistry,
  ],
  exports: [SourceRegistry],
})
export class SourcesModule {}
