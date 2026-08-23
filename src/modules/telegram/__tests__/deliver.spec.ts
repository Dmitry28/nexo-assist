import { makeListing as listing } from '@/__tests__/helpers/listing';

import { SEND_DELAY_MS, deliverDigest } from '../deliver';
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
