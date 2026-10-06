import { Module } from '@nestjs/common';

import { gsz } from './gsz/gsz.source';
import { kufar } from './kufar/kufar.source';
import { kufarTravel } from './kufar-travel/kufar-travel.source';
import { rabota } from './rabota/rabota.source';
import { realt } from './realt/realt.source';
import { createSourceAdapters } from './source-definition';
import { SOURCE_ADAPTERS, SourceRegistry } from './source-registry';

// Register a new source by adding its definition here — the only place that names them.
export const ADAPTERS = createSourceAdapters([kufar, kufarTravel, realt, gsz, rabota]);

@Module({
  providers: [{ provide: SOURCE_ADAPTERS, useValue: ADAPTERS }, SourceRegistry],
  exports: [SourceRegistry],
})
export class SourcesModule {}
