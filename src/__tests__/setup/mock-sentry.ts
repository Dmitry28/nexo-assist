// Error reporting goes through @sentry/nestjs. Stub it for every unit spec: tests must never
// send events, and what a report is judged on — user, tags, context — is set on the scope
// `withScope` hands out. Specs read it via `sentryScope()` / `sentryCapture()` from the helpers.
// Mocked here rather than per-spec because three specs already needed the identical factory.
jest.mock('@sentry/nestjs', () => {
  const scope = { setUser: jest.fn(), setTag: jest.fn(), setContext: jest.fn() };
  return {
    withScope: jest.fn((fn: (s: unknown) => void) => fn(scope)),
    captureException: jest.fn(),
    // Awaited before a deliberate process.exit, so it must resolve or that exit never happens.
    flush: jest.fn().mockResolvedValue(true),
    // Test-only handle: the scope is created inside the factory, so specs need a way in.
    __scope: scope,
  };
});
