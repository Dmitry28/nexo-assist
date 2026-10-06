import { Logger } from '@nestjs/common';

import { undiciFetchMock } from '@/__tests__/helpers/undici';

import type { SourceAdapter, SourceId } from '../source-adapter';
import { SourceUnavailableError } from '../source-adapter';
import { ADAPTERS } from '../sources.module';

// One real search per source. A Record, so a new SourceId without a sample fails to compile.
const SAMPLES: Record<SourceId, string> = {
  kufar: 'https://re.kufar.by/l/grodno/kupit/dom',
  'kufar-travel': 'https://travel.kufar.by/l/grodno/arendovat',
  realt: 'https://realt.by/grodno-region/sale/plots/',
  gsz: 'https://gsz.gov.by/registration/vacancy-search/?region=12380&district=14712',
};

// What every registered adapter owes the core — checked once here, not per adapter.
describe.each(ADAPTERS.map((Adapter) => [Adapter.name, new Adapter()] as const))(
  '%s contract',
  (_name, adapter: SourceAdapter) => {
    const fetchMock = undiciFetchMock();
    const sample = SAMPLES[adapter.id];

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Two adapters claiming one link would make the registry's pick an accident of order.
    it('is the only adapter that matches its sample search', () => {
      const claimants = ADAPTERS.map((Other) => new Other()).filter((a) => a.matches(sample));

      expect(claimants.map((a) => a.id)).toEqual([adapter.id]);
    });

    // An outage must not read as an empty search.
    it.each([
      ['a non-OK page', () => fetchMock.mockResolvedValue(new Response('', { status: 503 }))],
      ['a network failure', () => fetchMock.mockRejectedValue(new Error('network down'))],
    ])('rejects on %s', async (_case, arrange) => {
      arrange();

      await expect(adapter.fetch(sample)).rejects.toBeInstanceOf(SourceUnavailableError);
    });

    // The duplicate check drops exactly these; an undeclared one splits the same search in two.
    // Sees the first request only — a key set from page 2 on (kufar's cursor) is declared by hand.
    it('declares every param it sets on the first request', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }));
      await adapter.fetch(sample).catch(() => undefined);

      const sent = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
      const pasted = new URL(sample).searchParams;
      const changed = [...sent.keys()].filter((key) => sent.get(key) !== pasted.get(key));
      expect(adapter.volatileParams).toEqual(expect.arrayContaining(changed));
    });
  },
);
