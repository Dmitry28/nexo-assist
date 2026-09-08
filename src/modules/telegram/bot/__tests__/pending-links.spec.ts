import { MAX_PENDING_PER_USER, PENDING_TTL_MS, PendingLinks } from '../pending-links';

const link = (userId = 1, url = 'https://re.kufar.by/l/minsk') =>
  ({ userId, source: 'kufar', url }) as const;

describe('PendingLinks', () => {
  it('hands the stored link back to its owner', () => {
    const pending = new PendingLinks();

    const nonce = pending.add(link());

    expect(pending.take(nonce, 1)).toEqual(link());
  });

  it("refuses another user's nonce — a stranger must not subscribe someone's link", () => {
    const pending = new PendingLinks();
    const nonce = pending.add(link(1));

    expect(pending.take(nonce, 999)).toBeNull();
    // Refused, not consumed: the owner can still use their own prompt.
    expect(pending.take(nonce, 1)).toEqual(link(1));
  });

  it('consumes the nonce — a second tap on the same prompt is expired', () => {
    const pending = new PendingLinks();
    const nonce = pending.add(link());

    expect(pending.take(nonce, 1)).not.toBeNull();
    expect(pending.take(nonce, 1)).toBeNull();
  });

  it('refuses a nonce that was never stored', () => {
    expect(new PendingLinks().take('no-such-nonce', 1)).toBeNull();
  });

  // An anonymous sender (a channel post) has no id, and `undefined` must not match an entry.
  it('refuses an anonymous tap without consuming the prompt', () => {
    const pending = new PendingLinks();
    const nonce = pending.add(link(1, 'https://re.kufar.by/l/minsk'));

    expect(pending.take(nonce, undefined)).toBeNull();
    expect(pending.take(nonce, 1)).toEqual(link(1, 'https://re.kufar.by/l/minsk'));
  });

  it("evicts the user's oldest prompt at their cap — the map must not grow unbounded", () => {
    const pending = new PendingLinks();
    const oldest = pending.add(link(1, 'https://re.kufar.by/l/oldest'));
    for (let i = 1; i < MAX_PENDING_PER_USER; i++)
      pending.add(link(1, `https://re.kufar.by/l/${i}`));

    const newest = pending.add(link(1, 'https://re.kufar.by/l/newest'));

    expect(pending.take(oldest, 1)).toBeNull();
    expect(pending.take(newest, 1)).toEqual(link(1, 'https://re.kufar.by/l/newest'));
  });

  // The cap is per user for exactly this reason: a global one lets whoever pastes the most links
  // expire everyone else's open prompt.
  it("a flood from one user leaves another user's prompt tappable", () => {
    const pending = new PendingLinks();
    const mine = pending.add(link(1, 'https://re.kufar.by/l/mine'));

    for (let i = 0; i < MAX_PENDING_PER_USER * 3; i++) {
      pending.add(link(2, `https://re.kufar.by/l/flood-${i}`));
    }

    expect(pending.take(mine, 1)).toEqual(link(1, 'https://re.kufar.by/l/mine'));
  });

  it('expires a prompt left untapped past the TTL', () => {
    jest.useFakeTimers();
    try {
      const pending = new PendingLinks();
      const nonce = pending.add(link(1));

      jest.advanceTimersByTime(PENDING_TTL_MS);

      expect(pending.take(nonce, 1)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sweeps expired prompts out of the map instead of holding them for good', () => {
    jest.useFakeTimers();
    try {
      const pending = new PendingLinks();
      pending.add(link(1));
      jest.advanceTimersByTime(PENDING_TTL_MS);

      // Any later paste sweeps the stale entry, so memory does not grow with abandoned prompts.
      const fresh = pending.add(link(1, 'https://re.kufar.by/l/fresh'));

      expect(pending.size).toBe(1);
      expect(pending.take(fresh, 1)).toEqual(link(1, 'https://re.kufar.by/l/fresh'));
    } finally {
      jest.useRealTimers();
    }
  });
});
