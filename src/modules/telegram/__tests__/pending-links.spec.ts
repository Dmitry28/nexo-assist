import { MAX_PENDING, PendingLinks } from '../pending-links';

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

  it('evicts the oldest entry at the cap — the map must not grow unbounded', () => {
    const pending = new PendingLinks();
    const oldest = pending.add(link(1, 'https://re.kufar.by/l/oldest'));
    for (let i = 1; i < MAX_PENDING; i++) pending.add(link(1, `https://re.kufar.by/l/${i}`));

    const newest = pending.add(link(1, 'https://re.kufar.by/l/newest'));

    expect(pending.take(oldest, 1)).toBeNull();
    expect(pending.take(newest, 1)).toEqual(link(1, 'https://re.kufar.by/l/newest'));
  });
});
