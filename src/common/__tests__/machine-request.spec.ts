import { isMachineRequest } from '../machine-request';

const base = '/api/v1';
const is = (path: string): boolean => isMachineRequest({ path, base });

describe('isMachineRequest', () => {
  it.each(['/api/v1/health/live', '/api/v1/health/ready', '/api/v1/metrics'])(
    'recognises %s — polled every few seconds, and worth no log line',
    (path) => {
      expect(is(path)).toBe(true);
    },
  );

  // The point of the predicate is to hide noise, so over-matching is the dangerous direction:
  // silencing a real route is invisible until the day someone needs its logs.
  it.each([
    ['a user-facing route', '/api/v1/subscriptions'],
    ['a route that merely starts the same way', '/api/v1/metrics-admin'],
    ['the unversioned root', '/health/live'],
    ['a path outside the API base', '/api/v2/health/live'],
  ])('leaves %s alone', (_label, path) => {
    expect(is(path)).toBe(false);
  });
});
