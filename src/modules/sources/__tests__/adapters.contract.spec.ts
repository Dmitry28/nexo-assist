import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { sourceAdapter } from '@/__tests__/helpers/sources';
import { undiciFetchMock } from '@/__tests__/helpers/undici';
import { matchesHost } from '@/common/url';

import { SourceUnavailableError } from '../source-adapter';
import { ADAPTERS, SOURCES } from '../sources';

// A source folder whose definition is left out of SOURCES would pass every check below: each
// `<id>/<id>.source.ts` on disk must be registered (folder name = id, as the fixtures assume).
it('registers every source folder, once', () => {
  const folders = readdirSync(join(__dirname, '..'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(__dirname, '..', name, `${name}.source.ts`)));

  expect(SOURCES.map((s) => s.id).sort()).toEqual(folders.sort());
});

// What every registered adapter owes the core — checked once here, not per adapter.
describe.each(SOURCES.map((def) => [def.id, sourceAdapter(def.id), def.sample] as const))(
  '%s contract',
  (_name, adapter, sample) => {
    const fetchMock = undiciFetchMock();

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Two adapters claiming one link would make the registry's pick an accident of order.
    it('is the only adapter that matches its sample search', () => {
      const claimants = ADAPTERS.filter((a) => a.matches(sample));

      expect(claimants.map((a) => a.id)).toEqual([adapter.id]);
    });

    // An outage — or a 200 that is not the search page (a bot-wall) — must not read as empty.
    it.each([
      ['a non-OK page', () => fetchMock.mockResolvedValue(new Response('', { status: 503 }))],
      ['a network failure', () => fetchMock.mockRejectedValue(new Error('network down'))],
      ['a page with no data', () => fetchMock.mockResolvedValue(new Response('<html></html>'))],
    ])('rejects on %s', async (_case, arrange) => {
      arrange();

      await expect(adapter.fetch(sample)).rejects.toBeInstanceOf(SourceUnavailableError);
    });

    // The duplicate check drops exactly these; an undeclared one splits the same search in two.
    // Sees the first request only — the paging param itself (kufar's cursor) the factory declares.
    it('declares every param it sets on the first request', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }));
      await adapter.fetch(sample).catch(() => undefined);

      const sent = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
      const pasted = new URL(sample).searchParams;
      const changed = [...sent.keys()].filter((key) => sent.get(key) !== pasted.get(key));
      expect(adapter.volatileParams).toEqual(expect.arrayContaining(changed));
    });

    // Every source's live fixture, held to what the core relies on: a link on the site, a unique
    // id, a title, and a time that is empty or ISO (the card prints it; '' means unknown).
    it('maps its live fixture into listings the core can rely on', async () => {
      const fixture = readFileSync(
        join(__dirname, '..', adapter.id, '__tests__', 'fixtures', `${adapter.id}-search.html`),
        'utf8',
      );
      fetchMock
        .mockResolvedValueOnce(new Response(fixture))
        .mockResolvedValue(new Response('', { status: 503 }));

      const { listings } = await adapter.fetch(sample);

      expect(listings.length).toBeGreaterThan(0);
      const host = new URL(sample).hostname;
      for (const listing of listings) {
        expect(matchesHost({ url: listing.link, host })).toBe(true);
        expect(listing.externalId).not.toBe('');
        expect(listing.title).not.toBe('');
        expect(listing.listTime === '' || !Number.isNaN(Date.parse(listing.listTime))).toBe(true);
      }
      expect(new Set(listings.map((l) => l.externalId)).size).toBe(listings.length);
    });
  },
);
