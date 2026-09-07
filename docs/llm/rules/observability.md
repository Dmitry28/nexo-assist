# Observability

## A swallowed error must be reported

We swallow failures on purpose — one broken source must not kill a whole run — which is exactly why
they have to leave the process: logs die with the pod and can't answer "how many users hit this".
**A `catch` that keeps the run going calls `reportUserFacing`
([`telegram/report.ts`](../../../src/modules/telegram/report.ts)), not just the logger.** Rethrowing
or crashing needs nothing: the global filter and the fatal handlers report on their own — a
deliberate `process.exit` does not, see below.

**Log only, don't report**, when the failure is transient or expected and nobody would act on it —
a retryable network blip, a user who blocked the bot. An issue nobody acts on trains everyone to
ignore the next one.

The tags (`kind` / `action` / `op`) are closed unions in `report.ts` — add a value there rather than
passing a new string, and keep deriving `kind` from the error **type**, never from its message.
Why each exists and how it fits the four alert levels:
[PRODUCT_TECH.md § Как узнаём об ошибках](../../PRODUCT_TECH.md).

**Known blind spot:** admin alerts and dead-link notices still fail with a `logger.warn` only, so
the owner learns about them by silence. Tracked in [PRODUCT_PLAN.md](../../PRODUCT_PLAN.md)
§ Технический бэклог — extend that mechanism rather than adding a second one.

**A deliberate exit reports nothing on its own.** `main.ts`'s `reportAndExit` is bound only to
`uncaughtException`/`unhandledRejection`, so your own `logger.fatal` + `process.exit(1)` (the dead
polling loop in `telegram.service.ts` — the one failure that kills the whole product) produces no
Sentry event and no flush. Capture and `Sentry.flush` before exiting, or throw instead.

A spec asserts a report through `sentryScope()` / `sentryCapture()` from
`@/__tests__/helpers/sentry` — the stub is global
([testing.md § Don't Over-Mock](testing.md#dont-over-mock)).
