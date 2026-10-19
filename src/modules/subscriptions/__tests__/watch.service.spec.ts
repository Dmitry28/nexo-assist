import { Logger } from '@nestjs/common';

import { makeListing as listing } from '@/__tests__/helpers/listing';
import { sentryMessage } from '@/__tests__/helpers/sentry';
import { makeSubscription as sub } from '@/__tests__/helpers/subscription';
import { ListingGoneError, MAX_LISTINGS } from '@/modules/sources/source-adapter';
import type { Listing, SourceAdapter } from '@/modules/sources/source-adapter';
import { SourceRegistry } from '@/modules/sources/source-registry';

import type { Subscription } from '../entities/subscription.entity';
import type { ListingSnapshot } from '../price-change';
import type { SubscriptionsService } from '../subscriptions.service';
import { WatchService } from '../watch.service';
import type { SharedFetches } from '../watch.service';

// The seen set as getSeen returns it: id → stored snapshot (undefined: none yet).
const seenAs = (ids: string[], snapshots: Record<string, ListingSnapshot> = {}) =>
  new Map(ids.map((id) => [id, snapshots[id]]));

const baselined = (over: Partial<Subscription> = {}): Subscription =>
  sub({ baselinedAt: new Date(), ...over });

const build = (
  fetched: Listing[] = [],
  complete = true,
  capped = false,
  reportsRemoved = false,
) => {
  const adapter: SourceAdapter = {
    id: 'kufar',
    volatileParams: [],
    reportsRemoved,
    matches: () => true,
    fetch: jest.fn().mockResolvedValue({ listings: fetched, complete, capped }),
  };
  const subscriptions = {
    has: jest.fn().mockResolvedValue(true),
    seedBaseline: jest.fn().mockResolvedValue(undefined),
    getSeen: jest.fn().mockResolvedValue(seenAs([])),
    updateSnapshots: jest.fn().mockResolvedValue(undefined),
    markSeen: jest.fn().mockResolvedValue(undefined),
    seedPastWindow: jest.fn().mockResolvedValue(undefined),
    findGone: jest.fn().mockResolvedValue([]),
    deleteSeen: jest.fn().mockResolvedValue(undefined),
    markNotified: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
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

  // Ids are all a baseline needs — a source may skip item-page visits for it (gcn's prices).
  it('asks the source for ids only', async () => {
    const { adapter, watch } = build([listing(1)]);

    await watch.poll(sub());

    expect(adapter.fetch).toHaveBeenCalledWith(expect.any(String), { idsOnly: true });
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
    subscriptions.getSeen.mockResolvedValue(seenAs(['1', '3']));

    const outcome = await watch.poll(baselined());

    expect(outcome).toEqual({
      kind: 'fresh',
      listings: [listing(2)],
      priceChanges: [],
      removed: [],
    });
    expect(subscriptions.getSeen).toHaveBeenCalledWith('sub-1', ['1', '2', '3']);
  });

  it('reports nothing when every listing was already delivered', async () => {
    const { subscriptions, watch } = build([listing(1)]);
    subscriptions.getSeen.mockResolvedValue(seenAs(['1']));

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

// After the window grew, what lies past the old one was never shown — old listings, not new ones.
describe('WatchService.poll — the first check after the window grew', () => {
  const widened = () => baselined({ widenedFrom: 2 });

  it('seeds the listings past the old window silently, judges the ones inside it', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2), listing(3), listing(4)]);
    subscriptions.getSeen.mockResolvedValue(seenAs(['2']));

    const outcome = await watch.poll(widened());

    expect(outcome).toEqual({
      kind: 'fresh',
      listings: [listing(1)],
      priceChanges: [],
      removed: [],
    });
    expect(subscriptions.seedPastWindow).toHaveBeenCalledWith(
      'sub-1',
      [listing(3), listing(4)],
      true,
    );
  });

  // A failed later page left part of the window unfetched: catch it up next run, not as «new».
  it('keeps the old window size after a partial fetch', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2), listing(3)], false);

    await watch.poll(widened());

    expect(subscriptions.seedPastWindow).toHaveBeenCalledWith('sub-1', [listing(3)], false);
  });

  it('judges the whole window once the old size is forgotten', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2), listing(3)]);

    await expect(watch.poll(baselined())).resolves.toMatchObject({
      listings: [listing(1), listing(2), listing(3)],
    });
    expect(subscriptions.seedPastWindow).not.toHaveBeenCalled();
  });
});

describe('WatchService.poll — price changes', () => {
  const snap = (id: number, prices: Partial<ListingSnapshot>): ListingSnapshot => ({
    link: listing(id).link,
    title: listing(id).title,
    ...prices,
  });

  it('reports a seller change on a delivered listing, keeping its stored price until delivered', async () => {
    const after = listing(1, { priceByn: 270_000, priceUsd: 90_000 });
    const { subscriptions, watch } = build([after]);
    const before = snap(1, { priceByn: 300_000, priceUsd: 100_000 });
    subscriptions.getSeen.mockResolvedValue(seenAs(['1'], { '1': before }));

    await expect(watch.poll(baselined())).resolves.toEqual({
      kind: 'fresh',
      listings: [],
      priceChanges: [{ before, after }],
      removed: [],
    });
    // Not refreshed now: an undelivered change must come back next run.
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', []);
  });

  it('absorbs drift into the stored snapshot without telling anyone', async () => {
    const now = listing(1, { priceByn: 318_000, priceUsd: 100_000 });
    const { subscriptions, watch } = build([now]);
    subscriptions.getSeen.mockResolvedValue(
      seenAs(['1'], { '1': snap(1, { priceByn: 300_000, priceUsd: 100_000 }) }),
    );

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', [now]);
  });

  // A baseline row, or one from before snapshots: no price to compare with yet.
  it('fills a missing snapshot silently', async () => {
    const now = listing(1, { priceByn: 34_294 });
    const { subscriptions, watch } = build([now]);
    subscriptions.getSeen.mockResolvedValue(seenAs(['1']));

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', [now]);
  });

  // A parser fix or a site rewriting its prices moves everything at once — not sellers.
  it('absorbs a mass change silently and warns, instead of a digest of false changes', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const now = ids.map((id) => listing(id, { priceByn: 100 }));
    const { subscriptions, watch } = build(now);
    subscriptions.getSeen.mockResolvedValue(
      seenAs(
        ids.map(String),
        Object.fromEntries(ids.map((id) => [String(id), snap(id, { priceByn: 10_000 })])),
      ),
    );

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', now);
    expect(sentryMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Mass price change'),
      'warning',
    );
  });

  it('keeps the old snapshot while the price is missing, so its return is no change', async () => {
    const { subscriptions, watch } = build([listing(1)]);
    subscriptions.getSeen.mockResolvedValue(seenAs(['1'], { '1': snap(1, { priceByn: 5 }) }));

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', []);
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
    expect(outcome).toEqual({
      kind: 'fresh',
      listings: [listing(1), listing(2)],
      priceChanges: [],
      removed: [],
    });
    overflowed();
  });

  it('stays quiet when the window still overlaps what was delivered', async () => {
    const { subscriptions, watch } = build([listing(1), listing(2)], true, true);
    subscriptions.getSeen.mockResolvedValue(seenAs(['2']));

    await watch.poll(baselined());

    expect(sentryMessage()).not.toHaveBeenCalled();
  });

  // One paid page is all a protected source reads: a page of only new listings means more went past it.
  it('warns when a protected source turned its one page over', async () => {
    const { adapter, watch } = build([listing(1), listing(2)]);
    Object.assign(adapter, { paidPoll: { credits: 10, pool: 'geo' } });

    await watch.poll(baselined());

    overflowed();
  });

  it('stays quiet when the source ran out of pages — everything new was fetched', async () => {
    const { watch } = build([listing(1), listing(2)], true, false);

    await watch.poll(baselined());

    expect(sentryMessage()).not.toHaveBeenCalled();
  });
});

describe('WatchService.poll — removals', () => {
  const last = (id: number): ListingSnapshot => ({ link: listing(id).link, title: `t${id}` });
  // A sale list (reportsRemoved) whose page now shows listing 1; listing 2 was delivered before.
  const soldList = (complete = true, capped = false) => {
    const built = build([listing(1)], complete, capped, true);
    built.subscriptions.getSeen.mockResolvedValue(seenAs(['1'], { '1': last(1) }));
    built.subscriptions.findGone.mockResolvedValue([{ externalId: '2', snapshot: last(2) }]);
    return built;
  };

  it('reports a delivered listing gone from a page read whole, keeping its row until delivered', async () => {
    const { subscriptions, watch } = soldList();

    await expect(watch.poll(baselined())).resolves.toEqual({
      kind: 'fresh',
      listings: [],
      priceChanges: [],
      removed: [{ externalId: '2', last: last(2) }],
    });
    expect(subscriptions.findGone).toHaveBeenCalledWith('sub-1', ['1']);
    expect(subscriptions.deleteSeen).not.toHaveBeenCalledWith('sub-1', ['2']);
  });

  // The prototype once «sold» 45 cars when Cloudflare returned an empty page.
  it.each([
    ['a partial fetch', false, false],
    ['a capped fetch', true, true],
  ])('never removes on %s', async (_, complete, capped) => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { subscriptions, watch } = soldList(complete, capped);

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.findGone).not.toHaveBeenCalled();
  });

  it('never removes on an empty page', async () => {
    const { subscriptions, watch } = build([], true, false, true);

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.findGone).not.toHaveBeenCalled();
  });

  it('never removes on a source where leaving the page is no sale', async () => {
    const { subscriptions, watch } = build([listing(1)]);

    await watch.poll(baselined());
    expect(subscriptions.findGone).not.toHaveBeenCalled();
  });

  it('forgets a gone row with nothing to show, without telling anyone', async () => {
    const { subscriptions, watch } = soldList();
    subscriptions.findGone.mockResolvedValue([{ externalId: '2', snapshot: undefined }]);

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.deleteSeen).toHaveBeenCalledWith('sub-1', ['2']);
  });

  it('reports instead of removing when over half the list vanished at once', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { subscriptions, watch } = soldList();
    const gone = Array.from({ length: 10 }, (_, i) => ({ externalId: `g${i}`, snapshot: last(i) }));
    subscriptions.findGone.mockResolvedValue(gone);

    await expect(watch.poll(baselined())).resolves.toEqual({ kind: 'nothing' });
    expect(subscriptions.deleteSeen).not.toHaveBeenCalledWith('sub-1', ['g0']);
    expect(sentryMessage()).toHaveBeenCalledWith(
      expect.stringContaining('Mass removal'),
      'warning',
    );
  });
});

describe('WatchService — a watched single listing (item link)', () => {
  // kufar's item form — watchedItem reads it from the real source definitions.
  const itemSub = (over: Partial<Subscription> = {}) =>
    sub({ url: 'https://re.kufar.by/vi/7', ...over });
  const last: ListingSnapshot = { link: 'https://re.kufar.by/vi/7', title: 't7', priceByn: 100 };
  const goneSite = () => {
    const built = build();
    jest.mocked(built.adapter.fetch).mockResolvedValue({
      listings: [],
      complete: true,
      capped: false,
      gone: true,
    });
    return built;
  };

  it('stores the price at subscribe, so a change before the first poll is not swallowed', async () => {
    const { subscriptions, watch } = build([listing(7, { priceByn: 100 })]);

    await watch.baseline(itemSub());

    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', [
      listing(7, { priceByn: 100 }),
    ]);
  });

  it('refuses a listing already gone at subscribe', async () => {
    await expect(goneSite().watch.baseline(itemSub())).rejects.toThrow(ListingGoneError);
  });

  it("reports the listing removed on the site's word, though the page lists nothing", async () => {
    const { subscriptions, watch } = goneSite();
    subscriptions.findGone.mockResolvedValue([{ externalId: '7', snapshot: last }]);

    await expect(watch.poll(baselined({ url: 'https://re.kufar.by/vi/7' }))).resolves.toEqual({
      kind: 'fresh',
      listings: [],
      priceChanges: [],
      removed: [{ externalId: '7', last }],
    });
    expect(subscriptions.findGone).toHaveBeenCalledWith('sub-1', []);
  });

  it('tells a removal, not a failure, when the listing went before its first baseline', async () => {
    await expect(goneSite().watch.poll(itemSub())).resolves.toEqual({
      kind: 'fresh',
      listings: [],
      priceChanges: [],
      removed: [
        { externalId: '7', last: { link: 'https://re.kufar.by/vi/7', title: 'Объявление' } },
      ],
    });
  });

  it('tells nothing for a watch removed while its fetch was in flight', async () => {
    const { subscriptions, watch } = goneSite();
    subscriptions.has.mockResolvedValue(false);

    await expect(watch.poll(itemSub())).resolves.toEqual({ kind: 'nothing' });
  });

  it('pauses again, quietly, a watch revived after its removal was told', async () => {
    const { subscriptions, watch } = goneSite(); // findGone: no rows left

    await expect(watch.poll(baselined({ url: 'https://re.kufar.by/vi/7' }))).resolves.toEqual({
      kind: 'nothing',
    });
    expect(subscriptions.pause).toHaveBeenCalledWith('sub-1');
  });

  it('pauses the watch once its removal is delivered — a search is never paused for one', async () => {
    const { subscriptions, watch } = build();
    const delivered = { listings: [], priceChanges: [], removed: [{ externalId: '7', last }] };

    await watch.markDelivered(sub(), delivered);
    expect(subscriptions.pause).not.toHaveBeenCalled();

    await watch.markDelivered(itemSub(), delivered);
    expect(subscriptions.pause).toHaveBeenCalledWith('sub-1');
  });
});

// A run fetches each search once, whoever watches it — a protected source pays per page.
describe('WatchService.poll — fetches shared within a run', () => {
  const search = 'https://kufar.by/l?cat=1';
  const alice = baselined({ id: 'a', userId: 'alice', normalizedUrl: search });
  const bob = baselined({ id: 'b', userId: 'bob', normalizedUrl: search });

  it('fetches a search once and gives each watcher its own findings', async () => {
    const { adapter, watch } = build([listing(1)]);
    const shared: SharedFetches = new Map();

    await expect(watch.poll(alice, shared)).resolves.toMatchObject({ kind: 'fresh' });
    await expect(watch.poll(bob, shared)).resolves.toMatchObject({ kind: 'fresh' });

    expect(adapter.fetch).toHaveBeenCalledTimes(1);
  });

  it('serves a pending baseline from the same full fetch', async () => {
    const { adapter, subscriptions, watch } = build([listing(1)]);
    const shared: SharedFetches = new Map();

    await watch.poll(alice, shared);
    await watch.poll({ ...bob, baselinedAt: null }, shared);

    expect(adapter.fetch).toHaveBeenCalledTimes(1);
    expect(adapter.fetch).toHaveBeenCalledWith(alice.url, undefined);
    expect(subscriptions.seedBaseline).toHaveBeenCalledWith('b', ['1']);
  });

  it('fetches another search on its own, and shares a failure with the same one', async () => {
    const { adapter, watch } = build();
    jest.mocked(adapter.fetch).mockRejectedValueOnce(new Error('down'));
    const shared: SharedFetches = new Map();

    await expect(watch.poll(alice, shared)).rejects.toThrow('down');
    await expect(watch.poll(bob, shared)).rejects.toThrow('down');
    await watch.poll(baselined({ normalizedUrl: 'https://kufar.by/l?cat=2' }), shared);

    expect(adapter.fetch).toHaveBeenCalledTimes(2);
  });

  it('warns about a partial fetch once, not once per watcher', async () => {
    const { watch } = build([listing(1)], false);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shared: SharedFetches = new Map();

    await watch.poll(alice, shared);
    await watch.poll(bob, shared);

    expect(sentryMessage()).toHaveBeenCalledTimes(1);
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

  it('markDelivered forgets a delivered removal', async () => {
    const { subscriptions, watch } = build();

    await watch.markDelivered(sub(), {
      listings: [],
      priceChanges: [],
      removed: [{ externalId: '4', last: { link: 'l', title: 't' } }],
    });

    expect(subscriptions.deleteSeen).toHaveBeenCalledWith('sub-1', ['4']);
  });

  it('markDelivered records new listings as seen and delivered changes as the stored price', async () => {
    const { subscriptions, watch } = build();
    const after = listing(3, { priceUsd: 90 });

    await watch.markDelivered(sub(), {
      listings: [listing(7), listing(9)],
      priceChanges: [{ before: { link: after.link, title: after.title, priceUsd: 100 }, after }],
      removed: [],
    });

    expect(subscriptions.markSeen).toHaveBeenCalledWith('sub-1', [listing(7), listing(9)]);
    expect(subscriptions.updateSnapshots).toHaveBeenCalledWith('sub-1', [after]);
  });

  // The quiet report counts from this stamp; an empty delivery delivered nothing.
  it('stamps the user as notified after a delivery, and not when nothing was delivered', async () => {
    const { subscriptions, watch } = build();

    await watch.markDelivered(sub(), { listings: [], priceChanges: [], removed: [] });
    expect(subscriptions.markNotified).not.toHaveBeenCalled();

    await watch.markDelivered(sub(), { listings: [listing(7)], priceChanges: [], removed: [] });
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
