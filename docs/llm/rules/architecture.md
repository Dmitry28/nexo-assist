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
│   ├── filters/        # Global exception filters (consistent error JSON)
│   ├── interceptors/   # (empty by default — only add when a real cross-cutting need appears)
│   ├── guards/         # (empty by default)
│   ├── dto/            # Shared DTOs — PaginationQueryDto, PaginatedResponse, @ApiPaginatedResponse
│   └── utils/          # (empty by default — add per-need)
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

## Adding a New Env Variable

Update **all three** in lockstep:

1. `src/config/env.validation.ts` — declare on `EnvironmentVariables` with a validator + default (the single source of truth).
2. `src/config/configuration.ts` — extend `AppConfig` and map it.
3. `.env.example` — document it.
