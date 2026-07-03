# Testing Conventions

## Layout

- **Unit tests** — `<file>.spec.ts` in a `__tests__/` folder inside the same layer as the source (e.g. `sources/scraping/__tests__/paginate.spec.ts`), so specs don't clutter the source folder. Jest finds them anywhere under `src/`.
- **E2E tests** — under `test/` at the repo root (config in `test/jest-e2e.json`).
- **Integration** — cover the app boot (full `AppModule`) and non-HTTP flows (e.g. the watch loop) with `Test.createTestingModule` + `overrideProvider`; keep them green as modules grow.
- **Fixtures / helpers** — per-layer fixtures in that layer's `__tests__/fixtures/` (beside its specs); cross-cutting helpers in `src/__tests__/helpers/` (import via `@/__tests__/helpers/*`).

## Test Structure (AAA)

```typescript
describe('UsersService', () => {
  test('creates a user', () => {
    // Arrange
    const dto = { email: 'a@example.com', name: 'A' };

    // Act
    const user = service.create(dto);

    // Assert
    expect(user.email).toBe(dto.email);
  });
});
```

## What to Cover

- **Behaviour, not implementation.** Test what a unit produces, not how it does it.
- **Error paths**, not just the happy path — 404, 409, 429, validation failures, permission denials.
- **One concern per `test`.** Multiple `expect`s are fine when they verify a single behaviour; split otherwise.

## Don't Over-Mock

Globals wired through `APP_*` providers (`ValidationPipe`, `AllExceptionsFilter`, `ThrottlerGuard`, …) are picked up automatically by tests that import `AppModule`. **Don't re-register them** in `beforeAll` — it's drift waiting to happen.

In e2e, apply `configureApp(app)` from `src/app.setup.ts` after `createNestApplication()` so tests hit the same `/api/v1/...` routes as production (and k8s probes). Don't duplicate prefix/versioning setup inline.

For a unit with no injected dependencies, instantiate it directly (`new UsersService()`) — `Test.createTestingModule` earns its ceremony only once providers need wiring.

## Fixtures and Helpers

When the same fixture is rebuilt in 2+ specs, extract it. Reuse generic helpers globally; override only when a specific test needs different behaviour.

## Learning Tests (optional pattern)

For modules that integrate with an external API, a separate **learning test suite** that hits the real API documents and verifies its contract. Recommended when adopting/upgrading an integration; do not run on CI.

- File pattern: `*.test.learning.ts`.
- Excluded from the default test run; add a `test:learning` script when first needed.

## Console Rules

Tests should fail on unexpected `console.error` / `console.warn`. Fix the root cause, don't suppress. If a test genuinely needs to silence a known warning, scope the spy locally:

```typescript
jest.spyOn(console, 'error').mockImplementation(() => {});
```
