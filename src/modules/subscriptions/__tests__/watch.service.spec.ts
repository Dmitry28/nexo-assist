import { makeListing as listing } from '@/__tests__/helpers/listing';
import { makeSubscription as sub } from '@/__tests__/helpers/subscription';
import type { Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from '../entities/subscription.entity';
import type { SubscriptionsService } from '../subscriptions.service';
import { WatchService } from '../watch.service';

const baselined = (over: Partial<Subscription> = {}): Subscription =>
  sub({ baselinedAt: new Date(), ...over });

const build = (fetched: Listing[] = []) => {
  const adapter: SourceAdapter = {
    id: 'kufar',
    matches: () => true,
    fetch: jest.fn().mockResolvedValue(fetched),
  };
  const subscriptions = {
    has: jest.fn().mockResolvedValue(true),
    seedBaseline: jest.fn().mockResolvedValue(undefined),
    getSeen: jest.fn().mockResolvedValue(new Set<string>()),
    markSeen: jest.fn().mockResolvedValue(undefined),
  };
  // A real registry over a stub adapter — resolving the adapter is part of what is tested.
  const registry = new SourceRegistry([adapter]);
  const watch = new WatchService(subscriptions as unknown as SubscriptionsService, registry);
  return { adapter, subscriptions, watch };
};

describe('WatchService.poll — first run (baseline)', () => {
  it('seeds the seen set silently and reports how many were seeded', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2)]);

    await expect(watch.poll(sub())).resolves.toEqual({ kind: 'baselined', count: 2 });
    // Seeded, not delivered: a new subscriber must not receive the whole backlog.
    expect(subscriptions.seedBaseline).toHaveBeenCalledWith('sub-1', ['1', '2']);
  });

  it('reports nothing when the subscription was removed while the fetch was in flight', async () => {
    const { subscriptions, watch } = build([listing(1)]);
    subscriptions.has.mockResolvedValue(false);

    // Its seen set is gone with it, so anything reported now would look entirely fresh.
    await expect(watch.poll(sub())).resolves.toEqual({ kind: 'nothing' });
  });
});

describe('WatchService.poll — later runs (diff)', () => {
  it('returns only the listings that were never delivered', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2), listing(3)]);
    subscriptions.getSeen.mockResolvedValue(new Set(['1', '3']));

    const outcome = await watch.poll(baselined());

    expect(outcome).toEqual({ kind: 'fresh', listings: [listing(2)] });
    expect(subscriptions.getSeen).toHaveBeenCalledWith('sub-1', ['1', '2', '3']);
  });

  it('reports nothing when every listing was already delivered', async () => {
    const { subscriptions, watch } = build([listing(1)]);
    subscriptions.getSeen.mockResolvedValue(new Set(['1']));

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
  });

  it('reports nothing when the subscription disappeared, even with fresh listings', async () => {
    const { subscriptions, watch } = build([listing(1)]);
    subscriptions.has.mockResolvedValue(false);

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
  });

  it('marks nothing seen — the caller marks only what it actually delivered', async () => {
    const { subscriptions, watch } = build([listing(1)]);

    await watch.poll(baselined());

    expect(subscriptions.markSeen).not.toHaveBeenCalled();
  });
});

describe('WatchService — the rest of the contract', () => {
  it('propagates a fetch failure instead of reporting an empty search', async () => {
    const { adapter, watch } = build();
    (adapter.fetch as jest.Mock).mockRejectedValue(new Error('HTTP 503'));

    await expect(watch.poll(baselined())).rejects.toThrow('HTTP 503');
  });

  it('fails loudly when no adapter is registered for the source — that is a wiring bug', async () => {
    const { watch } = build();

    await expect(watch.poll(baselined({ source: 'realt' }))).rejects.toThrow('realt');
  });

  it('markSeen persists exactly the ids of the listings it was handed', async () => {
    const { subscriptions, watch } = build();

    await watch.markSeen(sub(), [listing(7), listing(9)]);

    expect(subscriptions.markSeen).toHaveBeenCalledWith('sub-1', ['7', '9']);
  });

  it('current reads listings without touching the seen set', async () => {
    const { subscriptions, watch } = build([listing(1)]);

    await expect(watch.current(sub())).resolves.toEqual([listing(1)]);
    expect(subscriptions.getSeen).not.toHaveBeenCalled();
    expect(subscriptions.markSeen).not.toHaveBeenCalled();
  });
});
