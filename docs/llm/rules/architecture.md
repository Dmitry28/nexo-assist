# Architecture

## Project Structure

```
src/
├── main.ts             # Bootstrap (helmet, CORS, ValidationPipe, versioning, Swagger, shutdown hooks)
├── tracing.ts          # OpenTelemetry init (must stay the first import in main.ts)
├── app.module.ts       # Root module: Config, Logger, Throttler, Prometheus, global filter/guard
├── config/
│   ├── configuration.ts   # registerAs('app', ...) — typed AppConfig + single validation point
│   └── env.validation.ts  # class-validator schema; single source of defaults; fail-fast on boot
├── common/
│   ├── common.module.ts   # @Global module exposing shared infra (SnapshotService, ...)
│   ├── snapshot.service.ts # Generic JSON-array snapshot persistence (for diff-based modules)
│   ├── filters/           # Global exception filters (consistent error JSON)
│   ├── dto/               # Shared DTOs — PaginationQueryDto, PaginatedResponse, @ApiPaginatedResponse
│   └── utils/             # Tiny generic helpers (sleep, ...)
├── health/             # Liveness + readiness probes (Terminus); @SkipThrottle()
└── modules/
    └── <feature>/      # Feature module — copy the `users` shape
        ├── dto/
        ├── entities/
        ├── <feature>.controller.ts
        ├── <feature>.service.ts
        └── <feature>.module.ts
```

## Module Rules

- Each feature = one NestJS module in `src/modules/<feature>/`.
- A module exports only what other modules explicitly need.
- `@Global()` only for truly app-wide shared infrastructure.

## Layer Responsibilities

| Layer      | Responsibility                                                  |
| ---------- | --------------------------------------------------------------- |
| Controller | HTTP only — parse request via DTOs, call service, shape response |
| Service    | Business logic — no HTTP, no Express/req objects                 |
| Module     | Wire dependencies, declare exports                               |
| DTO        | Input validation via `class-validator` + `@ApiProperty`          |
| Entity     | API-facing model (kept separate from any future persistence model) |

## Config Access

Always inject `ConfigService` — never use `process.env` directly inside modules:

```typescript
// ✅
constructor(private readonly config: ConfigService) {}
const port = this.config.get('app.port', { infer: true });

// ❌
process.env.PORT;
```

## Adding a New Feature Module

1. Create `src/modules/<feature>/` mirroring `users/`.
2. DTOs in `src/modules/<feature>/dto/` with `class-validator` + `@ApiProperty`.
3. Keep the entity API-facing — never leak ORM internals.
4. Throw Nest HTTP exceptions; the global `AllExceptionsFilter` formats them.
5. Register the module in `src/app.module.ts`.
6. Add a `*.service.spec.ts` (unit) and extend `test/app.e2e-spec.ts`.

## Subscription Module Pattern

This project's core domain is **subscribing to external sources and notifying on changes**. A subscription module fetches current state, diffs against the previous snapshot, dispatches notifications, and persists — in that order.

```
fetch current state  ──►  read previous snapshot  ──►  diff (new / removed / changed)
                                                                │
                                                                ▼
                                                       send notifications
                                                                │
                                                                ▼
                                                       persist new snapshot
```

### Invariants

- **Notify before persist.** If notification fails, the snapshot must NOT be updated — items stay "new" and are retried next run. Missing a notification is a critical failure.
- **One run at a time.** Guard the service entry with a boolean lock + watchdog timeout; throw `ConflictException` if already running.
- **Dynamic cron via `SchedulerRegistry`.** The static `@Cron()` decorator is evaluated before `ConfigModule` loads, so cron strings can't come from config. Schedule in `onModuleInit` with `SchedulerRegistry.addCronJob`.
- **State is typed.** Use `SnapshotService.read<T>(file, isT)` — the type guard catches schema drift on every read.

### Notification channels

A channel is anything that delivers a message externally (Telegram, Slack, webhook, email). Whatever channel you pick, implement these traits:

- **Dry-run mode** when credentials are absent — log the message instead of sending it. Lets the app run locally without secrets.
- **Per-recipient throttle** to respect provider rate limits.
- **Retry on rate-limit responses** (vendor-typed 429) with the `retry_after` hint when provided; other errors fail fast.
- **Typed error shape via type-guard** — never `as any` on a vendor error.

## CLI Scripts (`src/scripts/`)

For seed scripts, one-shot migrations, admin tasks, or anything that needs the DI container without HTTP, use `NestFactory.createApplicationContext` instead of `NestFactory.create`:

```typescript
// src/scripts/<name>.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SomeService } from '../modules/<feature>/<feature>.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    await app.get(SomeService).doSomething();
  } finally {
    await app.close();
  }
}

void main();
```

Run via:

```jsonc
// package.json
"scripts": {
  "task:<name>": "ts-node -r tsconfig-paths/register src/scripts/<name>.ts"
}
```

This keeps maintenance work in the same dependency graph as the app — no duplicated bootstrap, no out-of-band code.

## Adding a New Env Variable

Update **all three** in lockstep:

1. `src/config/env.validation.ts` — declare on `EnvironmentVariables` with a validator + default (the single source of truth).
2. `src/config/configuration.ts` — extend `AppConfig` and map it.
3. `.env.example` — document it.
