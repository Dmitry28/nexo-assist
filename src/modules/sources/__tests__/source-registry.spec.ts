import { KufarAdapter } from '../kufar/kufar.adapter';
import { RealtAdapter } from '../realt/realt.adapter';
import { SourceRegistry } from '../source-registry';

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
