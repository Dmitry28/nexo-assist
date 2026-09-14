import { Test } from '@nestjs/testing';

import { KufarAdapter } from '../kufar/kufar.adapter';
import { RealtAdapter } from '../realt/realt.adapter';
import { SourceRegistry } from '../source-registry';
import { SourcesModule } from '../sources.module';

describe('SourceRegistry', () => {
  const registry = new SourceRegistry([new KufarAdapter(), new RealtAdapter()]);

  it('matches a URL to its adapter', () => {
    expect(registry.match('https://re.kufar.by/l/minsk')?.id).toBe('kufar');
    expect(registry.match('https://realt.by/sale/plots/')?.id).toBe('realt');
  });

  it('returns null for an unsupported URL', () => {
    expect(registry.match('https://example.com/x')).toBeNull();
  });

  it('resolves an adapter by source id', () => {
    expect(registry.get('kufar')?.id).toBe('kufar');
    expect(registry.get('realt')?.id).toBe('realt');
  });
});

// The specs above build the registry by hand, so they say nothing about the wiring. A source
// that is provided but never reaches SOURCE_ADAPTERS resolves to no adapter — which the user
// sees as "we don't support that link", with nothing failing anywhere.
describe('SourcesModule wiring', () => {
  it('registers every adapter it provides', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SourcesModule] }).compile();

    const wired = moduleRef.get(SourceRegistry);

    expect(wired.get('kufar')).toBeInstanceOf(KufarAdapter);
    expect(wired.get('realt')).toBeInstanceOf(RealtAdapter);
  });
});
