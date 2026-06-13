import { KufarAdapter } from './kufar/kufar.adapter';
import { SourceRegistry } from './source-registry';

describe('SourceRegistry', () => {
  const registry = new SourceRegistry(new KufarAdapter());

  it('matches a kufar URL to the kufar adapter', () => {
    expect(registry.match('https://re.kufar.by/l/minsk')?.id).toBe('kufar');
  });

  it('returns null for an unsupported URL', () => {
    expect(registry.match('https://realt.by/x')).toBeNull();
  });

  it('resolves an adapter by source id', () => {
    expect(registry.get('kufar')?.id).toBe('kufar');
    expect(registry.get('realt')).toBeNull();
  });
});
