import type { SourceAdapter, SourceId } from '@/modules/sources/source-adapter';
import { ADAPTERS } from '@/modules/sources/sources';

/** The registered adapter of a source — the same instance the app wires. */
export function sourceAdapter(id: SourceId): SourceAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`no registered adapter for ${id}`);
  return adapter;
}
