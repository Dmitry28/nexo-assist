import { GrammyError } from 'grammy';

import { makeListing as listing } from '@/__tests__/helpers/listing';

import { SEND_DELAY_MS } from '../send-card';
import type { DeliveryTargets } from '../telegram.deliver';
import { deliverAndRecord, deliverFindings } from '../telegram.deliver';
import { CARDS_PER_DELIVERY, DIGEST_LIMIT } from '../telegram.format';

const many = (n: number) => Array.from({ length: n }, (_, i) => listing(i + 1));
const found = (n: number) => ({ listings: many(n), priceChanges: [], removed: [] });

/** A delivery target that records what went out as what. */
const stubTargets = () => ({
  card: jest.fn().mockResolvedValue(undefined),
  digest: jest.fn().mockResolvedValue(undefined),
});

/** Messages sent in order of the plan: cards first, then digest batches. */
const messages = (send: DeliveryTargets & { card: jest.Mock; digest: jest.Mock }): number =>
  send.card.mock.calls.length + send.digest.mock.calls.length;

describe('deliverFindings', () => {
  afterEach(() => jest.useRealTimers());

  it('sends a single listing as one card, without waiting first', async () => {
    const send = stubTargets();

    const { delivered, error } = await deliverFindings(found(1), send);

    expect(send.card).toHaveBeenCalledTimes(1);
    expect(send.digest).not.toHaveBeenCalled();
    expect(delivered.listings).toHaveLength(1);
    expect(error).toBeUndefined();
  });

  it('numbers the cards so a reader knows how many are coming', async () => {
    jest.useFakeTimers();
    const send = stubTargets();

    const run = deliverFindings(found(3), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 3);
    await run;

    expect(
      send.card.mock.calls.map(([message]) => (message as { caption: string }).caption),
    ).toEqual(expect.arrayContaining([expect.stringContaining('🆕 1/3')]));
  });

  // Everything found in a run goes out in that run: cards up to the limit, the rest as a digest.
  it('sends the listings past the card limit as digest messages', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    const fresh = CARDS_PER_DELIVERY + DIGEST_LIMIT;

    const run = deliverFindings(found(fresh), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * fresh);
    const { delivered } = await run;

    expect(send.card).toHaveBeenCalledTimes(CARDS_PER_DELIVERY);
    expect(send.digest).toHaveBeenCalledTimes(1);
    expect(delivered.listings).toHaveLength(fresh);
  });

  it('paces the messages after the first', async () => {
    jest.useFakeTimers();
    const send = stubTargets();

    const run = deliverFindings(found(2), send);
    await Promise.resolve();
    expect(messages(send)).toBe(1); // the second waits

    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS);
    await run;

    expect(messages(send)).toBe(2);
  });

  it('returns the prefix that arrived plus the error — the rest is retried, not the prefix', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    send.card.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('send failed'));

    const run = deliverFindings(found(3), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 3);
    const { delivered, error } = await run;

    expect(delivered.listings).toHaveLength(1);
    expect(error).toEqual(new Error('send failed'));
  });

  it('keeps delivering after one refused message — a poison listing must not hold the rest', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    // Only the second card is refused. Stopping there would leave listings 3-5 undelivered, and
    // since nothing undelivered is marked seen, the same card would lead the batch every run.
    send.card
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);

    const run = deliverFindings(found(5), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 5);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(5);
    expect(delivered.listings.map((l) => l.externalId)).toEqual(['1', '3', '4', '5']);
    // The failure is still reported — the caller tells the user part of it is coming later.
    expect(error).toEqual(new Error('send failed'));
  });

  it('gives up after a streak of failures — an outage must not cost a full paced loop', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    send.card.mockRejectedValue(new Error('telegram is down'));

    const run = deliverFindings(found(20), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 20);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(3);
    expect(delivered.listings).toHaveLength(0);
    expect(error).toEqual(new Error('telegram is down'));
  });

  it('counts the streak consecutively — scattered failures keep the delivery going', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    // Every other card fails: eight failures in all, never three in a row.
    let n = 0;
    send.card.mockImplementation(() =>
      ++n % 2 === 0 ? Promise.reject(new Error('send failed')) : Promise.resolve(undefined),
    );

    const run = deliverFindings(found(16), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 16);
    const { delivered } = await run;

    expect(send.card).toHaveBeenCalledTimes(16);
    expect(delivered.listings).toHaveLength(8);
  });

  it('stops when the chat is blocked — everything after it would be refused too', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    const blocked = new GrammyError(
      'Forbidden: bot was blocked by the user',
      { ok: false, error_code: 403, description: 'blocked' },
      'sendMessage',
      {},
    );
    send.card.mockResolvedValueOnce(undefined).mockRejectedValue(blocked);

    const run = deliverFindings(found(5), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 5);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(2);
    expect(delivered.listings).toHaveLength(1);
    expect(error).toBe(blocked);
  });
});

describe('deliverAndRecord', () => {
  afterEach(() => jest.useRealTimers());

  it('records nothing when nothing was delivered', async () => {
    const send = stubTargets();
    send.card.mockRejectedValue(new Error('send failed'));
    const record = jest.fn().mockResolvedValue(undefined);

    const { delivered, error, recordError } = await deliverAndRecord({
      found: found(1),
      send,
      record,
    });

    expect(record).not.toHaveBeenCalled();
    expect(delivered).toEqual({ listings: [], priceChanges: [], removed: [] });
    expect(error).toEqual(new Error('send failed'));
    expect(recordError).toBeUndefined();
  });

  it('returns a recording failure instead of throwing — the card already reached the user', async () => {
    const send = stubTargets();
    const record = jest.fn().mockRejectedValue(new Error('db down'));

    const { delivered, error, recordError } = await deliverAndRecord({
      found: found(1),
      send,
      record,
    });

    expect(delivered.listings).toHaveLength(1);
    expect(error).toBeUndefined();
    expect(recordError).toEqual(new Error('db down'));
  });

  it('records the delivered prefix when a later message fails', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    send.card.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('send failed'));
    const record = jest.fn().mockResolvedValue(undefined);

    const run = deliverAndRecord({ found: found(3), send, record });
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 3);
    const { delivered, error, recordError } = await run;

    expect(delivered.listings).toHaveLength(1);
    expect(record).toHaveBeenCalledWith(delivered);
    expect(error).toEqual(new Error('send failed'));
    expect(recordError).toBeUndefined();
  });

  it('reports no failure when everything went through', async () => {
    const send = stubTargets();
    const record = jest.fn().mockResolvedValue(undefined);

    const { delivered, error, recordError } = await deliverAndRecord({
      found: found(1),
      send,
      record,
    });

    expect(delivered.listings).toHaveLength(1);
    expect(error).toBeUndefined();
    expect(recordError).toBeUndefined();
  });
});

describe('price changes', () => {
  afterEach(() => jest.useRealTimers());

  it('go out after the new listings, as a digest, and are reported delivered', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    const after = listing(9, { priceUsd: 90_000 });
    const change = { before: { link: after.link, title: after.title, priceUsd: 100_000 }, after };

    const run = deliverFindings({ listings: many(1), priceChanges: [change], removed: [] }, send, {
      search: 'realt.by · x',
    });
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 2);
    const { delivered } = await run;

    expect(send.card).toHaveBeenCalledTimes(1);
    const [text] = send.digest.mock.calls[0] as [string];
    expect(text).toContain('💸 Цена изменилась: 1');
    expect(text).toContain('realt.by · x');
    expect(text).toContain('$100\u00a0000 → $90\u00a0000');
    expect(delivered).toEqual({ listings: [listing(1)], priceChanges: [change], removed: [] });
  });
});

describe('removals', () => {
  afterEach(() => jest.useRealTimers());

  it('go out last, as a digest, and are reported delivered', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    const removal = { externalId: '7', last: { link: 'https://ghb.by/7', title: 'Кв. 7' } };

    const run = deliverFindings({ listings: many(1), priceChanges: [], removed: [removal] }, send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 2);
    const { delivered } = await run;

    expect(send.digest.mock.calls[0][0]).toContain('🚫 Снято с продажи: 1');
    expect(delivered.removed).toEqual([removal]);
  });
});

// The helper and the composer are covered on their own; this is the wiring between them — a
// dropped argument in `plan` would leave every header unlabelled with the suite still green.
describe('the search label reaches the messages', () => {
  it('puts it in both the card header and the digest header', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    const fresh = CARDS_PER_DELIVERY + 1;

    const run = deliverFindings(found(fresh), send, { search: 'kufar · grodno/kupit/dom' });
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * (fresh + 1));
    await run;

    const [card] = send.card.mock.calls[0] as [{ caption: string }];
    expect(card.caption).toContain('kufar · grodno/kupit/dom');
    expect(send.digest.mock.calls[0][0]).toContain('kufar · grodno/kupit/dom');
  });
});
