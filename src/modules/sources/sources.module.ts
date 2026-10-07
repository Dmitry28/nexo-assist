import { Module } from '@nestjs/common';

import { SOURCE_ADAPTERS, SourceRegistry } from './source-registry';
import { ADAPTERS } from './sources';

@Module({
  providers: [{ provide: SOURCE_ADAPTERS, useValue: ADAPTERS }, SourceRegistry],
  exports: [SourceRegistry],
})
export class SourcesModule {}
