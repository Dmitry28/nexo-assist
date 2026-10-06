import { Test } from '@nestjs/testing';

import { sourceAdapter } from '@/__tests__/helpers/sources';

import { SourceRegistry } from '../source-registry';
import { ADAPTERS, SourcesModule } from '../sources.module';

describe('SourceRegistry', () => {
  const registry = new SourceRegistry([sourceAdapter('kufar'), sourceAdapter('realt')]);

  it('matches a URL to its adapter', () => {
    expect(registry.match('https://re.kufar.by/l/minsk')?.id).toBe('kufar');
    expect(registry.match('https://realt.by/sale/plots/')?.id).toBe('realt');
  });

  it('returns null for an unsupported URL', () => {
    expect(registry.match('https://example.com/x')).toBeNull();
  });

  // The dedup key of every stored subscription is built with this list — a change here changes
  // `normalizedUrl` under existing rows. Grow it only with a key a new adapter really sets.
  it('pins the duplicate-check params of all registered adapters', () => {
    const all = new SourceRegistry(ADAPTERS);

    expect(all.volatileParams().sort()).toEqual([
      'cursor',
      'hhtmFrom',
      'hhtmFromLabel',
      'items_on_page',
      'order_by',
      'page',
      'paginate_by',
      'search_session_id',
      'sort',
      'sortType',
      'sort_by',
    ]);
  });

  it('resolves an adapter by source id', () => {
    expect(registry.get('kufar')?.id).toBe('kufar');
    expect(registry.get('realt')?.id).toBe('realt');
  });
});

// The specs above build the registry by hand, so they say nothing about the wiring: a source
// missing from SOURCE_ADAPTERS reads to the user as "we don't support that link".
describe('SourcesModule wiring', () => {
  it('registers every adapter it provides', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SourcesModule] }).compile();

    const wired = moduleRef.get(SourceRegistry);

    expect(ADAPTERS.map((adapter) => wired.get(adapter.id))).toEqual(ADAPTERS);
  });
});
