import { makeListing as listing } from '@/__tests__/helpers/listing';
import { KufarAdapter } from '@/modules/sources/kufar/kufar.adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import { SubscriptionsService } from '../subscriptions.service';
import { WatchService } from '../watch.service';

describe('WatchService', () => {
  let subs: SubscriptionsService;
  let kufar: KufarAdapter;
  let watch: WatchService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    subs = new SubscriptionsService();
    kufar = new KufarAdapter();
    fetchSpy = jest.spyOn(kufar, 'fetch');
    watch = new WatchService(subs, new SourceRegistry([kufar]));
  });

  const addKufar = () =>
    subs.add({ telegramUserId: 1, source: 'kufar', url: 'https://kufar.by/l/x' });

  it('baseline seeds seen so an immediate check finds nothing new', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const count = await watch.baseline(sub);
    const fresh = await watch.check(sub);

    expect(count).toBe(2);
    expect(fresh).toEqual([]);
    expect(sub.baselinedAt).toBeInstanceOf(Date);
  });

  it('propagates a baseline fetch failure and leaves the subscription un-baselined', async () => {
    const sub = addKufar();
    fetchSpy.mockRejectedValue(new Error('outage'));

    await expect(watch.baseline(sub)).rejects.toThrow('outage');
    expect(sub.baselinedAt).toBeUndefined();
    expect(subs.getSeen(sub.id).size).toBe(0);
  });

  it('check returns only listings not seen before', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValueOnce([listing(1)]);
    await watch.baseline(sub);
    fetchSpy.mockResolvedValueOnce([listing(1), listing(2)]);

    const fresh = await watch.check(sub);

    expect(fresh.map((l) => l.externalId)).toEqual(['2']);
  });

  it('check is read-only — only markSeen dedups later checks', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    expect((await watch.check(sub)).map((l) => l.externalId)).toEqual(['1', '2']);
    // No markSeen yet → the same items are still fresh.
    expect((await watch.check(sub)).map((l) => l.externalId)).toEqual(['1', '2']);

    watch.markSeen(sub, [listing(1)]);
    expect((await watch.check(sub)).map((l) => l.externalId)).toEqual(['2']);
  });

  it('returns current listings read-only — a later check still sees them as new', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1)]);

    const current = await watch.current(sub);
    const fresh = await watch.check(sub);

    expect(current.map((l) => l.externalId)).toEqual(['1']);
    expect(fresh.map((l) => l.externalId)).toEqual(['1']);
  });

  it('poll baselines a pending subscription instead of reporting its backlog as fresh', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const outcome = await watch.poll(sub);

    expect(outcome).toEqual({ kind: 'baselined', count: 2 });
    expect(sub.baselinedAt).toBeInstanceOf(Date);
  });

  it('poll returns fresh listings without marking them seen', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValueOnce([listing(1)]);
    await watch.baseline(sub);
    fetchSpy.mockResolvedValue([listing(1), listing(2)]);

    const outcome = await watch.poll(sub);

    expect(outcome).toEqual({ kind: 'fresh', listings: [listing(2)] });
    // Still fresh on the next poll — only the caller's markSeen dedups it.
    expect(await watch.poll(sub)).toEqual({ kind: 'fresh', listings: [listing(2)] });
  });

  it('poll reports nothing when no new listings appeared', async () => {
    const sub = addKufar();
    fetchSpy.mockResolvedValue([listing(1)]);
    await watch.baseline(sub);

    expect(await watch.poll(sub)).toEqual({ kind: 'nothing' });
  });

  it('poll reports nothing for a subscription removed while the fetch was in flight', async () => {
    const sub = addKufar();
    subs.markBaselined(sub.id);
    fetchSpy.mockImplementation(() => {
      subs.remove(sub.id, sub.telegramUserId);
      return Promise.resolve([listing(1)]);
    });

    // The seen set is gone with the sub — without the guard everything would look fresh.
    expect(await watch.poll(sub)).toEqual({ kind: 'nothing' });
  });

  it('fails loudly for an unregistered source — a wiring bug must not read as empty', async () => {
    const sub = subs.add({ telegramUserId: 1, source: 'realt', url: 'https://realt.by/x' });

    await expect(watch.baseline(sub)).rejects.toThrow('adapter');
    await expect(watch.check(sub)).rejects.toThrow('adapter');
    expect(() => watch.current(sub)).toThrow('adapter');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
