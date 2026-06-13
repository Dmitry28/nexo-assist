# Architecture

## Project Structure

```
src/
├── main.ts             # Bootstrap (logger, Swagger, shutdown hooks, fatal handlers, listen)
├── app.setup.ts        # configureApp() — helmet, CORS, prefix, versioning; shared by main.ts and e2e
├── tracing.ts          # OpenTelemetry init (must stay the first import in main.ts)
├── app.module.ts       # Root module: Config, Logger, Throttler, Prometheus, global filter/guard
├── config/
│   ├── configuration.ts   # registerAs('app', ...) — typed AppConfig + single validation point
│   └── env.validation.ts  # class-validator schema; single source of defaults; fail-fast on boot
├── common/                # Cross-cutting building blocks
│   ├── filters/           # Global exception filters (consistent error JSON)
│   └── dto/               # Shared DTOs — PaginationQueryDto, PaginatedResponse, @ApiPaginatedResponse
├── health/             # Liveness + readiness probes (Terminus); @SkipThrottle()
├── metrics/            # MetricsModule + Prometheus controller override; @SkipThrottle()
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
- A module without HTTP (bot, background worker, domain service) omits the controller — e.g. `telegram`, `subscriptions`.
- Split a growing service into focused collaborators (e.g. `telegram.service.ts` lifecycle + `telegram.handlers.ts` logic); keep files small.
- A module exports only what other modules explicitly need.
- Shared layers (`common/`, `config/`) never import from `modules/` — enforced by ESLint `import-x/no-restricted-paths`.
- `@Global()` only for truly app-wide shared infrastructure.

## Layer Responsibilities

| Layer      | Responsibility                                                     |
| ---------- | ------------------------------------------------------------------ |
| Controller | HTTP only — parse request via DTOs, call service, shape response   |
| Service    | Business logic — no HTTP, no Express/req objects                   |
| Module     | Wire dependencies, declare exports                                 |
| DTO        | Input validation via `class-validator` + `@ApiProperty`            |
| Entity     | API-facing model (kept separate from any future persistence model) |

## Config Access

One style everywhere: inject the whole typed `AppConfig` by `configuration.KEY` — never use `process.env` directly inside modules, never read individual keys via `ConfigService.get('app.x')` string paths:

```typescript
// ✅ in services
constructor(@Inject(configuration.KEY) private readonly appConfig: AppConfig) {}
this.appConfig.port;

// ✅ in module factories
ThrottlerModule.forRootAsync({
  inject: [configuration.KEY],
  useFactory: (appConfig: AppConfig) => ({ ... }),
});

// ✅ in bootstrap / app.setup.ts
const appConfig = app.get<AppConfig>(configuration.KEY);

// ❌
process.env.PORT;
this.config.get('app.port');
```

## Adding a New Feature Module

1. Create `src/modules/<feature>/` mirroring `users/`.
2. DTOs in `src/modules/<feature>/dto/` with `class-validator` + `@ApiProperty`.
3. Keep the entity API-facing — never leak ORM internals.
4. Throw Nest HTTP exceptions; the global `AllExceptionsFilter` formats them.
5. Register the module in `src/app.module.ts`.
6. Add a `*.service.spec.ts` (unit) and extend `test/app.e2e-spec.ts`.

## CLI Scripts (`src/scripts/`)

For seed scripts, one-shot migrations, admin tasks, or anything that needs the DI container without HTTP, use `NestFactory.createApplicationContext` instead of `NestFactory.create`:

```typescript
// src/scripts/<name>.ts
import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/app.module';
import { SomeService } from '@/modules/<feature>/<feature>.service';

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

Run via (install `ts-node` + `tsconfig-paths` as devDependencies with the first script — they are intentionally absent until then):

```jsonc
// package.json
"scripts": {
  "task:<name>": "ts-node -r tsconfig-paths/register src/scripts/<name>.ts"
}
```

This keeps maintenance work in the same dependency graph as the app — no duplicated bootstrap, no out-of-band code.

## Adding a New Env Variable

Update **all of these** in lockstep:

1. `src/config/env.validation.ts` — declare on `EnvironmentVariables` with a validator + default (the single source of truth).
2. `src/config/configuration.ts` — extend `AppConfig` and map it.
3. `.env.example` — document it.
4. `k8s/configmap.yaml` — add it when the production value must differ from the default.
