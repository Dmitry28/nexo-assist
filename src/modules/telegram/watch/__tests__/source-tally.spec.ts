import { SOURCE_FAILURE_MIN_POLLS, SourceTally } from '../source-tally';

const recordPolls = ({
  tally,
  source,
  failed,
  count,
}: {
  tally: SourceTally;
  source: 'kufar' | 'realt';
  failed: boolean;
  count: number;
}): void => {
  for (let i = 0; i < count; i += 1) tally.record({ source, failed });
};

describe('SourceTally', () => {
  it('reports a source whose polls all failed at exactly the min-polls threshold', () => {
    const tally = new SourceTally();
    recordPolls({ tally, source: 'kufar', failed: true, count: SOURCE_FAILURE_MIN_POLLS });

    expect(tally.failedSources()).toEqual([
      { source: 'kufar', attempts: SOURCE_FAILURE_MIN_POLLS },
    ]);
  });

  it('reports nothing for an all-failed source one poll below the threshold', () => {
    const tally = new SourceTally();
    recordPolls({ tally, source: 'kufar', failed: true, count: SOURCE_FAILURE_MIN_POLLS - 1 });

    expect(tally.failedSources()).toEqual([]);
  });

  it('reports nothing for a mixed run above the threshold — one success clears the outage', () => {
    const tally = new SourceTally();
    recordPolls({ tally, source: 'kufar', failed: true, count: SOURCE_FAILURE_MIN_POLLS });
    tally.record({ source: 'kufar', failed: false });

    expect(tally.failedSources()).toEqual([]);
  });

  it('keeps sources independent — a broken one is reported, a healthy one is not', () => {
    const tally = new SourceTally();
    recordPolls({ tally, source: 'kufar', failed: true, count: SOURCE_FAILURE_MIN_POLLS });
    recordPolls({ tally, source: 'realt', failed: false, count: SOURCE_FAILURE_MIN_POLLS });

    expect(tally.failedSources()).toEqual([
      { source: 'kufar', attempts: SOURCE_FAILURE_MIN_POLLS },
    ]);
  });
});
