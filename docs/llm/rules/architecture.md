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
├── database/                 # TypeORM CLI data-source + generated migrations
│   ├── data-source.ts        # DataSource for the migration CLI (separate from the Nest module)
│   └── migrations/           # generated schema migrations
├── common/                # Cross-cutting building blocks (never import from modules/)
│   ├── filters/           # Global exception filters (consistent error JSON)
│   └── <helper>.ts        # Generic single-concern helpers (url, wait, …)
├── health/             # Liveness + readiness probes (Terminus); @SkipThrottle()
├── metrics/            # MetricsModule + Prometheus controller override; @SkipThrottle()
└── modules/
    ├── <feature>/      # Feature module — mirror an existing one (e.g. subscriptions)
    │   ├── dto/
    │   ├── entities/
    │   ├── __tests__/       # specs (+ fixtures) for this layer
    │   ├── <feature>.controller.ts
    │   ├── <feature>.service.ts
    │   └── <feature>.module.ts
    ├── sources/        # Source-plugin layer (specialized module)
    │   ├── source-adapter.ts   # Contract: SourceAdapter + Listing + SourceId
    │   ├── source-registry.ts  # Resolves an adapter by URL/id
    │   ├── listing-details.ts  # Builds the labelled detail lines adapters fill
    │   ├── sources.module.ts
    │   ├── scraping/           # Shared scraping toolkit (fetch, __NEXT_DATA__, paginate)
    │   └── <site>/             # One adapter per site (kufar, realt) + parser
    └── telegram/       # Two subsystems in concern subfolders — see § Module Rules
        ├── telegram.module.ts
        ├── report.ts           # Owned by neither concern → module root
        ├── bot/                # The conversation (service, handlers, format, deliver)
        └── watch/              # The scheduled run (scheduler, status, pacing, tally)
```

Specs live in a `__tests__/` folder within their own layer (not beside the source) — see [testing.md](testing.md#layout).

## Module Rules

- Each feature = one NestJS module in `src/modules/<feature>/`.
- A module without HTTP (bot, background worker, domain service) omits the controller — e.g. `telegram`, `subscriptions`.
- Split a growing service into focused collaborators (e.g. `telegram.service.ts` lifecycle + `telegram.handlers.ts` logic); keep files small.
- Once a module holds two subsystems, say which one **owns** each file — the owner, not the only caller. A file no single concern owns stays at the module root (`telegram/report.ts`).
- **`modules/telegram/` groups its files into `bot/` and `watch/` concern subfolders** (`bot/` = the conversation, `watch/` = the scheduled run; `bot/telegram.deliver.ts` is owned by the bot though the run calls it). This departs from the flat per-module layout NestJS generates and every other module here uses — a deliberate owner decision for legibility as the module grows, not a pattern to copy or to "fix" back. The real fix is the `modules/watch` split in [PRODUCT_PLAN.md](../../PRODUCT_PLAN.md) § Технический бэклог. NOTE: the folder boundary is **not** a dependency boundary — `bot/` imports `watch/watch.status.ts` and `watch/watch.pacing.ts`, and `watch/watch.scheduler.ts` imports `bot/telegram.deliver.ts`, so imports cross in both directions.
- A module exports only what other modules explicitly need.
- Shared layers (`common/`, `config/`) never import from `modules/` — enforced by ESLint `import-x/no-restricted-paths`.
- `@Global()` only for truly app-wide shared infrastructure.

## Environments

Two separate vars — never branch app logic on `NODE_ENV`:

| Stage      | `APP_ENV`     | Where         | `NODE_ENV` (technical) |
| ---------- | ------------- | ------------- | ---------------------- |
| local      | `development` | your machine  | development            |
| staging    | `staging`     | `dev` branch  | production             |
| production | `production`  | `main` branch | production             |
| test       | `test`        | jest          | test                   |

- **`APP_ENV`** is the single source for app behavior. Branch via the derived flags `appConfig.isProduction` / `isStaging` / `isDevelopment` / `isTest`, not inline comparisons.
- **`NODE_ENV`** stays technical (framework/tooling optimizations). `APP_ENV` defaults to `test` under jest, else `development`.

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

**One exception: credential-like values** (a proxy URL with a password, a watchdog ping URL). They
stay out of `AppConfig` because the bootstrap logs the whole config object — declare them in the
schema (so an invalid value still fails at boot) and read them from `process.env` where they are
used, saying why in the schema docblock. Precedents: `sources/scraping/http.ts`,
`health/heartbeat.service.ts`.

## Adding a New Feature Module

Mirror an existing module (`subscriptions/`) — the rest is standard Nest. What is ours:

- DTOs in `dto/` (`class-validator` + `@ApiProperty`), entities in `entities/`; **map entities to
  DTOs at the controller boundary** — never return a raw entity.
- Throw Nest HTTP exceptions; the global `AllExceptionsFilter` shapes the response.
- Schema changes only via a generated migration (see below).

## Database & migrations

Postgres via TypeORM. `TypeOrmModule.forRootAsync` (in `app.module.ts`) wires the app;
`synchronize: false` — schema changes go **only** through generated migrations. The
migration CLI uses a standalone `src/database/data-source.ts` (separate from the Nest
module): `npm run migration:generate|run|revert|show`.

For one-off DI scripts (seeds, admin tasks) use `NestFactory.createApplicationContext` in
`src/scripts/` via a `"task:<name>": "ts-node -r tsconfig-paths/register …"` script
(`ts-node`/`tsconfig-paths` are already devDependencies).

## Adding a New Env Variable

Update **all of these** in lockstep:

1. `src/config/env.validation.ts` — declare on `EnvironmentVariables` with a validator + default (the single source of truth).
2. `src/config/configuration.ts` — extend `AppConfig` and map it. Skip for credential-like values (see § Config Access) — they are read where used.
3. `.env.example` — document it.
4. `k8s/configmap.yaml` — add it when the production value must differ from the default.
