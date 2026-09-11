import { makeListing as listing } from '@/__tests__/helpers/listing';

import type { DeliveryTargets } from '../telegram.deliver';
import { SEND_DELAY_MS, deliverAndMark, deliverListings } from '../telegram.deliver';
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
