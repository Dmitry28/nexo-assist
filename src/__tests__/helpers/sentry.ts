import * as Sentry from '@sentry/nestjs';

interface SentryScope {
  setUser: jest.Mock;
  setTag: jest.Mock;
  setContext: jest.Mock;
}

/**
 * The scope the stubbed Sentry hands to `withScope` (see `__tests__/setup/mock-sentry.ts`) —
 * assert the user, tags and context a report attached. `clearMocks` resets calls between tests.
 */
export const sentryScope = (): SentryScope =>
  (Sentry as unknown as { __scope: SentryScope }).__scope;

/** The stubbed `captureException` — assert that something was reported at all. */
export const sentryCapture = (): jest.Mock => Sentry.captureException as unknown as jest.Mock;
