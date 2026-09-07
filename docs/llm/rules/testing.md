# Testing Conventions

## Layout

- **Unit tests** — `<file>.spec.ts` in a `__tests__/` folder inside the same layer as the source (e.g. `sources/scraping/__tests__/paginate.spec.ts`), so specs don't clutter the source folder. Jest finds them anywhere under `src/`.
- **E2E tests** — under `test/` at the repo root (config in `test/jest-e2e.json`).
- **Integration** — cover the app boot (full `AppModule`) and non-HTTP flows (e.g. the watch loop) with `Test.createTestingModule` + `overrideProvider`; keep them green as modules grow.
- **Fixtures / helpers** — per-layer fixtures in that layer's `__tests__/fixtures/` (beside its specs); cross-cutting helpers in `src/__tests__/helpers/` (import via `@/__tests__/helpers/*`).
- **App-wide specs** — a spec that belongs to no single layer (e.g. `src/__tests__/di-wiring.spec.ts`, which loads `AppModule` to catch import cycles that strip DI metadata) lives directly in `src/__tests__/`, beside `helpers/`.

## What to Cover

- **Behaviour, not implementation** — and the error paths, not just the happy one.
- **One concern per `test`.** Several `expect`s are fine when they verify one behaviour.
- A new test must **fail against the unfixed code** — otherwise you don't know what it guards.
  **Verify it, never assume: delete the guard (or revert the fix), re-run, see red, restore.**
  Re-check that after refactoring the code it covers.
- **Every guard clause, cap and ordering rule is behaviour** and takes the same deletion check.
  Skipping it is how a dozen of them shipped into `modules/telegram/` deletable with a green suite.

## Don't Over-Mock

Globals wired through `APP_*` providers (`ValidationPipe`, `AllExceptionsFilter`, `ThrottlerGuard`, …) are picked up automatically by tests that import `AppModule`. **Don't re-register them** in `beforeAll` — it's drift waiting to happen.

In e2e, apply `configureApp(app)` from `src/app.setup.ts` after `createNestApplication()` so tests hit the same `/api/v1/...` routes as production (and k8s probes). Don't duplicate prefix/versioning setup inline.

For a unit with no injected dependencies, instantiate it directly (`new UsersService()`) — `Test.createTestingModule` earns its ceremony only once providers need wiring.

The global stubs in `src/__tests__/setup/` (Sentry, `undici` fetch) are deliberately generic so most specs need no setup. Bend one for a single case with `mockImplementationOnce` / `mockResolvedValueOnce` on its helper — **never `jest.mock()` the same module inside a spec**, which replaces the shared stub for that whole file and leaves the helpers reading nothing ([observability.md § Testing a report](observability.md#testing-a-report)).

## Fixtures and Helpers

When the same fixture is rebuilt in 2+ specs, extract it. Reuse generic helpers globally; override only when a specific test needs different behaviour.

## Console Rules

Tests should fail on unexpected `console.error` / `console.warn`. Fix the root cause, don't suppress. If a test genuinely needs to silence a known warning, scope the spy locally:

```typescript
jest.spyOn(console, 'error').mockImplementation(() => {});
```
