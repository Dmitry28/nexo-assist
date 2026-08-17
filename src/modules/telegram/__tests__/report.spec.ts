import { sentryCapture, sentryScope } from '@/__tests__/helpers/sentry';
import { SourceUnavailableError } from '@/modules/sources/scraping/http';

import { reportUserFacing } from '../report';

describe('reportUserFacing', () => {
  it('attaches the user so Sentry can count how many people hit the same issue', () => {
    reportUserFacing(new Error('boom'), { userId: 42, action: 'subscribe', url: 'https://x.by/l' });

    expect(sentryScope().setUser).toHaveBeenCalledWith({ id: '42' });
    expect(sentryScope().setContext).toHaveBeenCalledWith('subscription', {
      url: 'https://x.by/l',
    });
    expect(sentryCapture()).toHaveBeenCalled();
  });

  it('marks a dead source as "source", not as our bug', () => {
    reportUserFacing(new SourceUnavailableError('HTTP 503'), { action: 'check' });

    expect(sentryScope().setTag).toHaveBeenCalledWith('kind', 'source');
  });

  it('marks anything else as a bug — that is what needs fixing', () => {
    reportUserFacing(new TypeError('undefined is not a function'), { action: 'check' });

    expect(sentryScope().setTag).toHaveBeenCalledWith('kind', 'bug');
  });

  it('tags the failing operation when the action alone does not identify it', () => {
    reportUserFacing(new Error('db down'), {
      action: 'daily',
      op: 'mark-seen',
      details: { id: 'sub-1', resending: 3 },
    });

    expect(sentryScope().setTag).toHaveBeenCalledWith('op', 'mark-seen');
    expect(sentryScope().setContext).toHaveBeenCalledWith('subscription', {
      id: 'sub-1',
      resending: 3,
    });
  });

  it('omits the context block when there is nothing to put in it', () => {
    reportUserFacing(new Error('boom'), { action: 'bot-update' });

    expect(sentryScope().setContext).not.toHaveBeenCalled();
    expect(sentryScope().setTag).not.toHaveBeenCalledWith('op', expect.anything());
  });
});
