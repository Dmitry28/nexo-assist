import { POLL_STUCK_AFTER_MS, WatchStatus } from '../watch.status';

describe('WatchStatus polling slot', () => {
  let status: WatchStatus;

  beforeEach(() => {
    jest.useFakeTimers();
    status = new WatchStatus();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hands the slot to one claimant and refuses the next', () => {
    expect(status.tryStartPolling().claim).toBe('started');
    expect(status.tryStartPolling().claim).toBe('busy');
  });

  it('frees the slot on release', () => {
    const slot = status.tryStartPolling();
    status.finishPolling(slot.key);

    expect(status.tryStartPolling().claim).toBe('started');
    expect(status.isPollInProgress).toBe(true);
  });

  // The failure this guards: a run that never settles holds the slot forever, the bot stops
  // polling for good, and nothing says so. Without the reclaim only a restart brings it back.
  it('reclaims a slot nobody released, and says that is what happened', () => {
    status.tryStartPolling();

    jest.advanceTimersByTime(POLL_STUCK_AFTER_MS);

    expect(status.tryStartPolling().claim).toBe('reclaimed');
  });

  it('still refuses a slot held for less than the limit — a slow run is not a stuck one', () => {
    status.tryStartPolling();

    jest.advanceTimersByTime(POLL_STUCK_AFTER_MS - 1);

    expect(status.tryStartPolling().claim).toBe('busy');
  });

  // The hole a reclaim opens: the hung run still owns a `finally`. When its await finally
  // settles it must not hand away a slot that now belongs to someone else — that would put two
  // pollers on the same subscriptions, which is the thing the slot exists to prevent.
  it('ignores a release from the run whose slot was taken', () => {
    const stale = status.tryStartPolling();
    jest.advanceTimersByTime(POLL_STUCK_AFTER_MS);
    status.tryStartPolling(); // the run that reclaimed it is now polling

    status.finishPolling(stale.key); // the hung run comes back to life

    expect(status.tryStartPolling().claim).toBe('busy');
  });

  it('reports a stale slot as free, so a read-only peek does not lie', () => {
    status.tryStartPolling();

    jest.advanceTimersByTime(POLL_STUCK_AFTER_MS);

    expect(status.isPollInProgress).toBe(false);
  });

  it('restarts the clock on a reclaim, so the next claimant waits the full limit again', () => {
    status.tryStartPolling();
    jest.advanceTimersByTime(POLL_STUCK_AFTER_MS);
    status.tryStartPolling();

    expect(status.tryStartPolling().claim).toBe('busy');
  });
});
