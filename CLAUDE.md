# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

A production-ready NestJS 11 skeleton. The `users` module is a reference implementation —
copy its shape when building new modules. Keep the architecture consistent rather than
introducing new patterns.

## Commands

```bash
npm run start:dev      # dev server (watch)
npm run lint           # ESLint — must pass with zero warnings
npm run format         # Prettier write
npm run typecheck      # tsc --noEmit
npm test               # unit tests (*.spec.ts)
npm run test:e2e       # e2e tests (test/*.e2e-spec.ts)
npm run build          # compile to dist/
```

Before claiming a change is done, run: `npm run lint && npm run typecheck && npm test`.

## Architecture & conventions

- **Modules** live in `src/modules/<name>/` and follow the `users` layout:
  `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`.
- **Controllers** stay thin: validate input (DTOs), delegate to the service, shape the
  response. No business logic.
- **Services** hold business logic. Throw NestJS HTTP exceptions
  (`NotFoundException`, `ConflictException`, …) — never return error objects. The global
  `AllExceptionsFilter` formats them into consistent JSON.
- **DTOs** use `class-validator` decorators for validation and `@ApiProperty` for OpenAPI.
  The global `ValidationPipe` (`whitelist + forbidNonWhitelisted + transform`) strips and
  rejects unknown fields — rely on it; don't hand-roll validation.
- **List endpoints** return `PaginatedResponse<T>` and are documented with
  `@ApiPaginatedResponse(Model)` (see `users.controller.ts`) — don't hand-write the
  `{ data, meta }` schema per endpoint.
- **Entities** in `entities/` are the API-facing shape. When a DB is added, keep these
  separate from persistence models and map between them — never leak ORM internals.
- **Config**: read via `ConfigService.get('app.<key>', { infer: true })`. Add new env vars
  to BOTH `src/config/env.validation.ts` (schema) and `src/config/configuration.ts`
  (typed accessor) and `.env.example`. The app fails to boot on invalid config — keep it
  that way.
- **Logging**: use the injected `nestjs-pino` logger, not `console.*`.
- **Imports**: use the `@/*` path alias for intra-`src` imports.
- **Routes** are URI-versioned: handlers live under `/api/v1/...` automatically.
- **Rate limiting**: a global `ThrottlerGuard` is active. Use `@SkipThrottle()` /
  `@Throttle()` to adjust per route; probes are already exempt.
- **Health**: liveness (`/health/live`) stays cheap and dependency-free; put dependency
  checks (DB, upstreams) only in readiness (`/health/ready`).
- **Metrics/Tracing**: Prometheus metrics at `/metrics`; OpenTelemetry is opt-in via
  `OTEL_*` env (`src/tracing.ts` must stay the first import in `main.ts`).

## Testing

- Every service gets a `*.service.spec.ts` (unit, no HTTP).
- Cover new endpoints in `test/app.e2e-spec.ts`.
- Test behavior and error paths (e.g. 404/409), not just the happy path.

## Style

- Strict TypeScript. No `any` (warns), no unused locals/params (errors).
- Prettier owns formatting — don't fight it. Single quotes, trailing commas, width 100.
- Match the surrounding code's idioms and comment density.

## Gotchas

- `transform: true` + `enableImplicitConversion` means query/param strings are coerced to
  DTO types — annotate DTO fields with `@Type(() => Number)` where needed (see
  `PaginationQueryDto`).
- Swagger is disabled when `NODE_ENV=production`.
- The `users` store is in-memory and resets on restart — it's a placeholder for a real repo.
