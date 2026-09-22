import { OUTAGE_REMINDER_RUNS, SourceHealth } from '../source-health';

describe('SourceHealth', () => {
  let health: SourceHealth;

  beforeEach(() => {
    health = new SourceHealth();
  });

  // `down` carries the poll count the alert prints; `succeeded` is proof the source answered.
  const run = (down: 'kufar'[] = [], succeeded: ('kufar' | 'realt')[] = ['kufar']) =>
    health.update({
      down: down.map((source) => ({ source, attempts: 3 })),
      succeeded: succeeded.filter((s) => !down.includes(s as 'kufar')),
    });

  it('says a source is down the first time it is', () => {
    expect(run(['kufar'])).toEqual([{ kind: 'down', source: 'kufar', attempts: 3 }]);
  });

  // The point of the whole class: a daily cron would otherwise send the same line every morning
  // until the fix lands, which is how an alert channel stops being read.
  it('stays silent while the source is still down', () => {
    run(['kufar']);

    expect(run(['kufar'])).toEqual([]);
    expect(run(['kufar'])).toEqual([]);
  });

  it('reminds once every OUTAGE_REMINDER_RUNS runs, so it is not forgotten either', () => {
    const signals = Array.from({ length: OUTAGE_REMINDER_RUNS + 1 }, () => run(['kufar'])).flat();

    expect(signals).toEqual([
      { kind: 'down', source: 'kufar', attempts: 3 },
      { kind: 'still-down', source: 'kufar', runs: OUTAGE_REMINDER_RUNS + 1 },
    ]);
  });

  it('announces the recovery, with how long it lasted', () => {
    run(['kufar']);
    run(['kufar']);

    expect(run([])).toEqual([{ kind: 'recovered', source: 'kufar', runs: 2 }]);
  });

  it('announces a recovery once, not on every later run', () => {
    run(['kufar']);
    run([]);

    expect(run([])).toEqual([]);
  });

  // A source with no subscriptions this run is not a source that recovered — nothing was tried.
  it('says nothing about a source the run never polled', () => {
    run(['kufar']);

    expect(health.update({ down: [], succeeded: ['realt'] })).toEqual([]);
  });

  // The trap: the outage verdict needs at least SOURCE_FAILURE_MIN_POLLS polls, so a source
  // whose subscriptions drop below that leaves `down` while still failing every poll. Calling
  // that recovery would tell the owner it is fixed when nothing was fixed.
  it('stays silent when the source is still failing but was polled too few times to judge', () => {
    run(['kufar']);

    expect(health.update({ down: [], succeeded: [] })).toEqual([]);
    expect(run([])).toEqual([{ kind: 'recovered', source: 'kufar', runs: 1 }]);
  });
});
