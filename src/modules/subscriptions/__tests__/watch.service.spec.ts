import { Logger } from '@nestjs/common';

import { makeListing as listing } from '@/__tests__/helpers/listing';
import { sentryMessage } from '@/__tests__/helpers/sentry';
import { makeSubscription as sub } from '@/__tests__/helpers/subscription';
import { MAX_LISTINGS } from '@/modules/sources/source-adapter';
import type { Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from '../entities/subscription.entity';
import type { SubscriptionsService } from '../subscriptions.service';
import { WatchService } from '../watch.service';

const baselined = (over: Partial<Subscription> = {}): Subscription =>
  sub({ baselinedAt: new Date(), ...over });

const build = (fetched: Listing[] = [], complete = true, capped = false) => {
  const adapter: SourceAdapter = {
    id: 'kufar',
    volatileParams: [],
    matches: () => true,
    fetch: jest.fn().mockResolvedValue({ listings: fetched, complete, capped }),
  };
  const subscriptions = {
    has: jest.fn().mockResolvedValue(true),
    seedBaseline: jest.fn().mockResolvedValue(undefined),
    getSeen: jest.fn().mockResolvedValue(new Set<string>()),
    markSeen: jest.fn().mockResolvedValue(undefined),
    markNotified: jest.fn().mockResolvedValue(undefined),
  };
  // A real registry over a stub adapter — resolving the adapter is part of what is tested.
  const registry = new SourceRegistry([adapter]);
  const watch = new WatchService(subscriptions as unknown as SubscriptionsService, registry);
  return { adapter, subscriptions, watch };
};

describe('WatchService.poll — first run (baseline)', () => {
  // A partial baseline under-counts the search, so the listings it missed read as "new" later.
  // It is still marked done on purpose (see baseline's NOTE) — the flag is what makes the cause
  // visible instead of leaving a burst of fake "new" to be explained away.
  it('reports a partial fetch, because nothing else would', async () => {
    const { watch } = build([listing(1)], false);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(watch.poll(sub())).resolves.toEqual({ kind: 'baselined', count: 1 });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Partial fetch'));
    expect(sentryMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Partial fetch'),
      'warning',
    );
  });

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

// What `capped` is for: listings published past the page window between two runs are never
// fetched, and nothing else would ever say so (backlog, «Больше 150 новых за сутки…»).
describe('WatchService.poll — page window overflow', () => {
  const overflowed = () =>
    expect(sentryMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Page window overflowed'),
      'warning',
    );

  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

  it('warns when the source had more pages and none of the window was seen before', async () => {
    const { watch } = build([listing(1), listing(2)], true, true);

    const outcome = await watch.poll(baselined());

    // Still delivered as usual — the signal reports the loss, it does not change delivery.
    expect(outcome).toEqual({ kind: 'fresh', listings: [listing(1), listing(2)] });
    overflowed();
  });

  it('stays quiet when the window still overlaps what was delivered', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2)], true, true);
    subscriptions.getSeen.mockResolvedValue(new Set(['2']));

    await watch.poll(baselined());

    expect(sentryMessage()).not.toHaveBeenCalled();
  });

  it('stays quiet when the source ran out of pages — everything new was fetched', async () => {
    const { watch } = build([listing(1), listing(2)], true, false);

    await watch.poll(baselined());

    expect(sentryMessage()).not.toHaveBeenCalled();
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

  // The quiet report counts from this stamp; an empty markSeen delivered nothing.
  it('stamps the user as notified after a delivery, and not when nothing was delivered', async () => {
    const { subscriptions, watch } = build();

    await watch.markSeen(sub(), []);
    expect(subscriptions.markNotified).not.toHaveBeenCalled();

    await watch.markSeen(sub(), [listing(7)]);
    expect(subscriptions.markNotified).toHaveBeenCalledWith('user-1');
  });

  it('current reads listings without touching the seen set', async () => {
    const { subscriptions, watch } = build([listing(1)]);

    await expect(watch.current(sub())).resolves.toEqual([listing(1)]);
    expect(subscriptions.getSeen).not.toHaveBeenCalled();
    expect(subscriptions.markSeen).not.toHaveBeenCalled();
  });
});

// The stored-seen cap only bounds the table safely while it stays comfortably above what one
// fetch returns. Nothing else in the system can notice that assumption breaking, so this warn
// is the only tripwire — and a silent break means pruned-but-still-visible listings are
// re-delivered as new on every run.
describe('WatchService — the seen-set cap assumption', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays quiet for an ordinary page window', async () => {
    const { watch } = build([listing(1), listing(2)]);

    await watch.current(sub());

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when a fetch exceeds the MAX_LISTINGS window', async () => {
    const many = Array.from({ length: MAX_LISTINGS + 1 }, (_, i) => listing(i));
    const { watch } = build(many);

    await watch.check(baselined());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAX_SEEN_PER_SUBSCRIPTION'));
  });
});
