# Project Entry Point

## About

**nexo-assist** — production-ready NestJS 11 skeleton for shipping pet-project modules to production. New features live in `src/modules/<feature>/`, mirroring the reference `users` module.

## Key Commands

```bash
npm run start:dev       # dev server with hot-reload
npm run build           # compile TypeScript
npm run start:prod      # run production build
npm run typecheck       # type check without emitting (fast)
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run format:check    # Prettier check (no writes)
npm test                # unit tests
npm run test:cov        # tests with coverage report
npm run test:e2e        # e2e tests
```

Before claiming a change is done, run: `npm run lint && npm run typecheck && npm test`.

## Key Files

- `package.json` — dependencies and scripts (NestJS 11, class-validator, helmet, throttler, swagger, terminus, pino, prometheus, opentelemetry).
- `src/main.ts` — bootstrap (helmet, CORS, ValidationPipe, URI versioning, Swagger, shutdown hooks).
- `src/tracing.ts` — OpenTelemetry init (must stay the first import in `main.ts`).
- `src/app.module.ts` — root module (Config, Logger, Throttler, Prometheus, Health, global filter + guard).
- `src/config/configuration.ts` — typed `AppConfig` exposed under `app.*`.
- `src/config/env.validation.ts` — class-validator schema; single source of defaults; fail-fast on boot.
- `src/modules/users/` — reference feature module; copy its shape.
- `src/common/dto/` — pagination DTOs + `@ApiPaginatedResponse` decorator.

## Core Rules

- Each solution: simple, clear, concise.
- **No over-engineering.** Don't anticipate futures; don't add abstractions before a second consumer exists.
- Follow existing NestJS module structure — mirror the `users` module.

## Workflow

Follow the [Workflow Loop](rules/workflow.md) for every task: Plan → Implement → Verify → Fix.

## Quick Reference

| Topic                  | Doc                                |
| ---------------------- | ---------------------------------- |
| Code style             | [rules/code-style.md](rules/code-style.md) |
| TypeScript             | [rules/typescript.md](rules/typescript.md) |
| Architecture           | [rules/architecture.md](rules/architecture.md) |
| Development philosophy | [rules/development-philosophy.md](rules/development-philosophy.md) |
| Code review            | [rules/code-review.md](rules/code-review.md) |
| Debugging              | [rules/debugging.md](rules/debugging.md) |
| Testing                | [rules/testing.md](rules/testing.md) |
| Workflow               | [rules/workflow.md](rules/workflow.md) |
| LLM skills             | [rules/llm-skills-guide.md](rules/llm-skills-guide.md) |
