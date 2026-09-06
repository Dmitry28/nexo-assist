import { In, IsNull } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { makeSubscription } from '@/__tests__/helpers/subscription';

import type { SeenListing } from '../entities/seen-listing.entity';
import { Subscription } from '../entities/subscription.entity';
import type { User } from '../entities/user.entity';
import {
  DuplicateSubscriptionError,
  MAX_SEEN_PER_SUBSCRIPTION,
  MAX_SUBSCRIPTIONS_PER_USER,
  SubscriptionLimitError,
  SubscriptionsService,
} from '../subscriptions.service';

// The active-subscription cap is anti-abuse logic shared by a fresh add and a revive, so both
// paths and their ORDER relative to the duplicate check are what these specs pin.

const USER: User = { id: 'user-1', telegramId: 42 } as User;

const paused = (over: Partial<Subscription> = {}): Subscription =>
  makeSubscription({ userId: USER.id, pausedAt: new Date(), ...over });

const active = (over: Partial<Subscription> = {}): Subscription =>
  makeSubscription({ userId: USER.id, pausedAt: null, ...over });

const build = () => {
  // The insert goes through a query builder; capture what it was handed.
  const makeInsert = () => ({
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  });
  const makeManager = () => ({
    createQueryBuilder: jest.fn(),
    query: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn(),
  });

  // NOTE: the transactional manager is a DISTINCT double from the base one. Handing the same
  // object to both makes "written inside the transaction" and "written outside it"
  // indistinguishable, and a spec that cannot tell them apart silently passes when the
  // atomicity it claims to pin is gone.
  const insert = makeInsert();
  const txInsert = makeInsert();
  const manager = makeManager();
  const txManager = makeManager();
  manager.createQueryBuilder.mockImplementation(() => ({ insert: () => ({ into: () => insert }) }));
  txManager.createQueryBuilder.mockImplementation(() => ({
    insert: () => ({ into: () => txInsert }),
  }));
  // Assigned after the objects exist: referencing them inside their own initializer
  // makes the type circular.
  manager.transaction.mockImplementation((cb: (m: EntityManager) => Promise<unknown>) =>
    cb(txManager as unknown as EntityManager),
  );

  const subs = {
    findOneBy: jest.fn().mockResolvedValue(null),
    findOneByOrFail: jest.fn().mockResolvedValue(active()),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity: Partial<Subscription>) => entity as Subscription),
    save: jest.fn((entity: Subscription) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    existsBy: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    // NOTE: load-bearing — `seedBaseline` reaches the transaction through `subs.manager`.
    manager,
  };
  const users = {
    upsert: jest.fn().mockResolvedValue(undefined),
    findOneByOrFail: jest.fn().mockResolvedValue(USER),
  };
  const seen = {
    manager,
    findBy: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SubscriptionsService(
    subs as unknown as Repository<Subscription>,
    seen as unknown as Repository<SeenListing>,
    users as unknown as Repository<User>,
  );
  return { subs, users, seen, manager, txManager, insert, txInsert, service };
};

const addInput = { user: { telegramId: 42 }, source: 'kufar' as const, url: 'https://kufar.by/l' };

describe('SubscriptionsService.add', () => {
  it('refuses a fresh add once the user is at the active cap', async () => {
    const { subs, service } = build();
    subs.countBy.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER);

    await expect(service.add(addInput)).rejects.toBeInstanceOf(SubscriptionLimitError);
    expect(subs.save).not.toHaveBeenCalled();
  });

  it('counts active subscriptions only, so paused ones cannot lock a user out', async () => {
    const { subs, service } = build();
    subs.countBy.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER - 1);

    await service.add(addInput);

    expect(subs.save).toHaveBeenCalled();
    // The operator itself, not merely its presence: `expect.anything()` would also accept
    // Not(IsNull()), i.e. a cap that counts only the paused rows — the exact inverse.
    expect(subs.countBy).toHaveBeenCalledWith({ userId: USER.id, pausedAt: IsNull() });
  });

  it('reports an already-active duplicate before consulting the cap', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(active());
    subs.countBy.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER);

    // Order matters: at the cap, a duplicate must still read as "you already watch this",
    // not as "you ran out of slots" — the latter sends the user hunting for a free slot.
    await expect(service.add(addInput)).rejects.toBeInstanceOf(DuplicateSubscriptionError);
    expect(subs.countBy).not.toHaveBeenCalled();
  });

  it('caps a revive exactly like a fresh add', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(paused());
    subs.countBy.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER);

    await expect(service.add(addInput)).rejects.toBeInstanceOf(SubscriptionLimitError);
    expect(subs.update).not.toHaveBeenCalled();
  });

  it('revives a paused subscription and clears its failure streak', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(paused());

    await service.add(addInput);

    expect(subs.update).toHaveBeenCalledWith(
      { id: 'sub-1' },
      { pausedAt: null, consecutiveFailures: 0 },
    );
    expect(subs.save).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.resume', () => {
  it('refuses to un-pause once the user is at the active cap', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(paused());
    subs.countBy.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER);

    await expect(service.resume('sub-1', 42)).rejects.toBeInstanceOf(SubscriptionLimitError);
    expect(subs.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an already-active subscription, without spending a cap check', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(active());

    await expect(service.resume('sub-1', 42)).resolves.toBe(true);
    expect(subs.countBy).not.toHaveBeenCalled();
    expect(subs.update).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller, so nobody can un-pause a stranger’s subscription', async () => {
    const { subs, service } = build();
    subs.findOneBy.mockResolvedValue(null);

    await expect(service.resume('sub-1', 999)).resolves.toBe(false);
    // The ownership filter is the security boundary here — a stubbed null would pass even if
    // `resume` looked the subscription up by id alone.
    expect(subs.findOneBy).toHaveBeenCalledWith({ id: 'sub-1', user: { telegramId: 999 } });
  });
});

describe('SubscriptionsService.remove', () => {
  it('scopes the delete to the caller, so nobody can remove a stranger’s subscription', async () => {
    const { subs, service } = build();
    subs.existsBy.mockResolvedValue(false);

    await expect(service.remove('sub-1', 999)).resolves.toBe(false);
    expect(subs.existsBy).toHaveBeenCalledWith({ id: 'sub-1', user: { telegramId: 999 } });
    expect(subs.delete).not.toHaveBeenCalled();
  });

  it('deletes only after ownership is confirmed', async () => {
    const { subs, service } = build();

    await expect(service.remove('sub-1', 42)).resolves.toBe(true);
    expect(subs.delete).toHaveBeenCalledWith({ id: 'sub-1' });
  });
});

describe('SubscriptionsService — the seen set', () => {
  it('asks the database nothing when the run produced no candidates', async () => {
    const { seen, service } = build();

    await expect(service.getSeen('sub-1', [])).resolves.toEqual(new Set());
    expect(seen.findBy).not.toHaveBeenCalled();
  });

  it('returns the already-delivered ids and refreshes their timestamps', async () => {
    const { seen, service } = build();
    seen.findBy.mockResolvedValue([{ externalId: 'a' }, { externalId: 'b' }]);

    await expect(service.getSeen('sub-1', ['a', 'b', 'c'])).resolves.toEqual(new Set(['a', 'b']));
    // The rows and the field, not merely that some update ran: refreshing seenAt keeps ids
    // still inside the page window out of the prune's reach — otherwise a bumped listing
    // could lose its row and be re-delivered as new.
    expect(seen.update).toHaveBeenCalledWith(
      { subscriptionId: 'sub-1', externalId: In(['a', 'b']) },
      { seenAt: expect.any(Date) },
    );
  });

  it('writes nothing when there is nothing to mark', async () => {
    const { insert, manager, service } = build();

    await service.markSeen('sub-1', []);

    expect(insert.execute).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled(); // and no prune either
  });

  it('inserts ignoring duplicates, then prunes the window', async () => {
    const { insert, manager, service } = build();

    await service.markSeen('sub-1', ['a', 'b']);

    expect(insert.values).toHaveBeenCalledWith([
      { subscriptionId: 'sub-1', externalId: 'a' },
      { subscriptionId: 'sub-1', externalId: 'b' },
    ]);
    expect(insert.orIgnore).toHaveBeenCalled(); // re-marking a delivered id must not throw
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM seen_listings'),
      ['sub-1', MAX_SEEN_PER_SUBSCRIPTION],
    );
  });

  it('seeds and flags the baseline inside ONE transaction, not around it', async () => {
    const { manager, txManager, insert, txInsert, service } = build();

    await service.seedBaseline('sub-1', ['a']);

    // A crash between the two would leave a half-seeded baseline marked done, and it would
    // never re-seed — so BOTH writes must go through the transactional manager. Asserting
    // that they happened is not enough; they must not have happened on the base one.
    expect(manager.transaction).toHaveBeenCalledTimes(1);
    expect(txInsert.execute).toHaveBeenCalled();
    expect(txManager.update).toHaveBeenCalledWith(
      Subscription,
      { id: 'sub-1' },
      { baselinedAt: expect.any(Date) },
    );
    expect(insert.execute).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });
});
