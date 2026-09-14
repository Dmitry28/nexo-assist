import { Module } from '@nestjs/common';

import { KufarAdapter } from './kufar/kufar.adapter';
import { RealtAdapter } from './realt/realt.adapter';
import type { SourceAdapter } from './source-adapter';
import { SOURCE_ADAPTERS, SourceRegistry } from './source-registry';

// Register a new source by adding its adapter here — the only place that names them, so an
// adapter cannot end up half-registered (provided but missing from the registry, which reads to
// the user as "we don't support that link"). SourceRegistry stays untouched.
const ADAPTERS = [KufarAdapter, RealtAdapter];

@Module({
  providers: [
    ...ADAPTERS,
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (...adapters: SourceAdapter[]) => adapters,
      inject: ADAPTERS,
    },
    SourceRegistry,
  ],
  exports: [SourceRegistry],
})
export class SourcesModule {}
