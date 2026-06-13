import { Injectable } from '@nestjs/common';

import { KufarAdapter } from './kufar/kufar.adapter';
import type { SourceAdapter, SourceId } from './source-adapter';

/** Holds the source adapters and resolves them by URL or id. */
@Injectable()
export class SourceRegistry {
  private readonly adapters: SourceAdapter[];

  // NOTE: adapters are injected so a new source is added by registering its provider here.
  constructor(kufar: KufarAdapter) {
    this.adapters = [kufar];
  }

  /** Adapter that handles this URL, or null. */
  match(url: string): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }

  /** Adapter for a known source id, or null. */
  get(id: SourceId): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.id === id) ?? null;
  }
}
