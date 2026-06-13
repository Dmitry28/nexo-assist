import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapter, SourceId } from './source-adapter';

/** DI token for the list of registered source adapters. */
export const SOURCE_ADAPTERS = Symbol('SOURCE_ADAPTERS');

/** Holds the source adapters and resolves them by URL or id. */
@Injectable()
export class SourceRegistry {
  // NOTE: adapters are injected as a list — a new source is added by registering it in the
  // SOURCE_ADAPTERS provider, without touching this class.
  constructor(@Inject(SOURCE_ADAPTERS) private readonly adapters: SourceAdapter[]) {}

  /** Adapter that handles this URL, or null. */
  match(url: string): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }

  /** Adapter for a known source id, or null. */
  get(id: SourceId): SourceAdapter | null {
    return this.adapters.find((adapter) => adapter.id === id) ?? null;
  }
}
