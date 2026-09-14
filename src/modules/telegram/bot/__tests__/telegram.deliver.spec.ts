import { GrammyError } from 'grammy';

import { makeListing as listing } from '@/__tests__/helpers/listing';

import { SEND_DELAY_MS } from '../send-card';
import type { DeliveryTargets } from '../telegram.deliver';
import { deliverAndMark, deliverListings } from '../telegram.deliver';
import { CARDS_PER_DELIVERY, DIGEST_LIMIT } from '../telegram.format';

const many = (n: number) => Array.from({ length: n }, (_, i) => listing(i + 1));

/** A delivery target that records what went out as what. */
const stubTargets = () => ({
  card: jest.fn().mockResolvedValue(undefined),
  digest: jest.fn().mockResolvedValue(undefined),
});

/** Messages sent in order of the plan: cards first, then digest batches. */
const messages = (send: DeliveryTargets & { card: jest.Mock; digest: jest.Mock }): number =>
  send.card.mock.calls.length + send.digest.mock.calls.length;

describe('deliverListings', () => {
  afterEach(() => jest.useRealTimers());

  it('sends a single listing as one card, without waiting first', async () => {
    const send = stubTargets();

    const { delivered, error } = await deliverListings(many(1), send);

    expect(send.card).toHaveBeenCalledTimes(1);
    expect(send.digest).not.toHaveBeenCalled();
    expect(delivered).toHaveLength(1);
    expect(error).toBeUndefined();
  });

  it('numbers the cards so a reader knows how many are coming', async () => {
    jest.useFakeTimers();
    const send = stubTargets();

    const run = deliverListings(many(3), send);
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

    const run = deliverListings(many(fresh), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * fresh);
    const { delivered } = await run;

    expect(send.card).toHaveBeenCalledTimes(CARDS_PER_DELIVERY);
    expect(send.digest).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveLength(fresh);
  });

  it('paces the messages after the first', async () => {
    jest.useFakeTimers();
    const send = stubTargets();

    const run = deliverListings(many(2), send);
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

    const run = deliverListings(many(3), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 3);
    const { delivered, error } = await run;

    expect(delivered).toHaveLength(1);
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

    const run = deliverListings(many(5), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 5);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(5);
    expect(delivered.map((l) => l.externalId)).toEqual(['1', '3', '4', '5']);
    // The failure is still reported — the caller tells the user part of it is coming later.
    expect(error).toEqual(new Error('send failed'));
  });

  it('gives up after a streak of failures — an outage must not cost a full paced loop', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    send.card.mockRejectedValue(new Error('telegram is down'));

    const run = deliverListings(many(20), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 20);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(3);
    expect(delivered).toHaveLength(0);
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

    const run = deliverListings(many(16), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 16);
    const { delivered } = await run;

    expect(send.card).toHaveBeenCalledTimes(16);
    expect(delivered).toHaveLength(8);
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

    const run = deliverListings(many(5), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 5);
    const { delivered, error } = await run;

    expect(send.card).toHaveBeenCalledTimes(2);
    expect(delivered).toHaveLength(1);
    expect(error).toBe(blocked);
  });
});

describe('deliverAndMark', () => {
  afterEach(() => jest.useRealTimers());

  it('skips markSeen when nothing was delivered', async () => {
    const send = stubTargets();
    send.card.mockRejectedValue(new Error('send failed'));
    const markSeen = jest.fn().mockResolvedValue(undefined);

    const { delivered, error, markSeenError } = await deliverAndMark({
      listings: many(1),
      send,
      markSeen,
    });

    expect(markSeen).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
    expect(error).toEqual(new Error('send failed'));
    expect(markSeenError).toBeUndefined();
  });

  it('returns a markSeen failure instead of throwing — the card already reached the user', async () => {
    const send = stubTargets();
    const markSeen = jest.fn().mockRejectedValue(new Error('db down'));

    const { delivered, error, markSeenError } = await deliverAndMark({
      listings: many(1),
      send,
      markSeen,
    });

    expect(delivered).toHaveLength(1);
    expect(error).toBeUndefined();
    expect(markSeenError).toEqual(new Error('db down'));
  });

  it('marks the delivered prefix seen when a later message fails', async () => {
    jest.useFakeTimers();
    const send = stubTargets();
    send.card.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('send failed'));
    const markSeen = jest.fn().mockResolvedValue(undefined);

    const run = deliverAndMark({ listings: many(3), send, markSeen });
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS * 3);
    const { delivered, error, markSeenError } = await run;

    expect(delivered).toHaveLength(1);
    expect(markSeen).toHaveBeenCalledWith(delivered);
    expect(error).toEqual(new Error('send failed'));
    expect(markSeenError).toBeUndefined();
  });

  it('reports no failure when everything went through', async () => {
    const send = stubTargets();
    const markSeen = jest.fn().mockResolvedValue(undefined);

    const { delivered, error, markSeenError } = await deliverAndMark({
      listings: many(1),
      send,
      markSeen,
    });

    expect(delivered).toHaveLength(1);
    expect(error).toBeUndefined();
    expect(markSeenError).toBeUndefined();
  });
});
