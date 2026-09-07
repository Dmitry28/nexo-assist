import { makeListing as listing } from '@/__tests__/helpers/listing';

import { SEND_DELAY_MS, deliverAndMark, deliverDigest } from '../telegram.deliver';
import { DIGEST_LIMIT } from '../telegram.format';

const many = (n: number) => Array.from({ length: n }, (_, i) => listing(i + 1));

describe('deliverDigest', () => {
  afterEach(() => jest.useRealTimers());

  it('sends one message without waiting first', async () => {
    const send = jest.fn().mockResolvedValue(undefined);

    const { delivered, error } = await deliverDigest(many(1), send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveLength(1);
    expect(error).toBeUndefined();
  });

  it('paces the messages after the first', async () => {
    jest.useFakeTimers();
    const send = jest.fn().mockResolvedValue(undefined);

    const run = deliverDigest(many(DIGEST_LIMIT + 1), send);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1); // the second waits

    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS);
    await run;

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns the prefix that arrived plus the error — the rest is retried, not the prefix', async () => {
    jest.useFakeTimers();
    const send = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('send failed'));

    const run = deliverDigest(many(DIGEST_LIMIT + 1), send);
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS);
    const { delivered, error } = await run;

    expect(delivered).toHaveLength(DIGEST_LIMIT);
    expect(error).toEqual(new Error('send failed'));
  });
});

describe('deliverAndMark', () => {
  afterEach(() => jest.useRealTimers());

  it('skips markSeen when nothing was delivered', async () => {
    const send = jest.fn().mockRejectedValue(new Error('send failed'));
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

  it('returns a markSeen failure instead of throwing — the digest already reached the user', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
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
    const send = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('send failed'));
    const markSeen = jest.fn().mockResolvedValue(undefined);

    const run = deliverAndMark({ listings: many(DIGEST_LIMIT + 1), send, markSeen });
    await jest.advanceTimersByTimeAsync(SEND_DELAY_MS);
    const { delivered, error, markSeenError } = await run;

    expect(delivered).toHaveLength(DIGEST_LIMIT);
    expect(markSeen).toHaveBeenCalledWith(delivered);
    expect(error).toEqual(new Error('send failed'));
    expect(markSeenError).toBeUndefined();
  });

  it('reports no failure when everything went through', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
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
