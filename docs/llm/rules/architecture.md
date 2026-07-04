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
│   └── url.ts             # Generic URL helpers (extract/withParam/matchesHost)
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
    └── sources/        # Source-plugin layer (specialized module)
        ├── source-adapter.ts   # Contract: SourceAdapter + Listing + SourceId
        ├── source-registry.ts  # Resolves an adapter by URL/id
        ├── sources.module.ts
        ├── scraping/           # Shared scraping toolkit (fetch, __NEXT_DATA__, paginate)
        └── <site>/             # One adapter per site (kufar, realt) + parser
```

Specs live in a `__tests__/` folder within their own layer (not beside the source) — see [testing.md](testing.md#layout).

## Module Rules

- Each feature = one NestJS module in `src/modules/<feature>/`.
- A module without HTTP (bot, background worker, domain service) omits the controller — e.g. `telegram`, `subscriptions`.
- Split a growing service into focused collaborators (e.g. `telegram.service.ts` lifecycle + `telegram.handlers.ts` logic); keep files small.
- A module exports only what other modules explicitly need.
- Shared layers (`common/`, `config/`) never import from `modules/` — enforced by ESLint `import-x/no-restricted-paths`.
- `@Global()` only for truly app-wide shared infrastructure.

## Layer Responsibilities

| Layer      | Responsibility                                                                 |
| ---------- | ------------------------------------------------------------------------------ |
| Controller | HTTP only — parse request via DTOs, call service, shape response               |
| Service    | Business logic — no HTTP, no Express/req objects                               |
| Module     | Wire dependencies, declare exports                                             |
| DTO        | Input validation via `class-validator` + `@ApiProperty`                        |
| Entity     | TypeORM persistence model (`@Entity`); map to a DTO at the controller boundary |

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

## Adding a New Feature Module

1. Create `src/modules/<feature>/` mirroring an existing module (e.g. `subscriptions/`).
2. DTOs in `dto/` (`class-validator` + `@ApiProperty`); entities in `entities/` (TypeORM `@Entity`).
3. Register entities via `TypeOrmModule.forFeature([...])`, inject repositories with
   `@InjectRepository`, and map entities to DTOs at the controller boundary — don't return raw entities.
4. Throw Nest HTTP exceptions; the global `AllExceptionsFilter` formats them.
5. Register the module in `src/app.module.ts`; schema changes go through a generated migration
   (see Database & migrations).
6. Add a `*.service.spec.ts` (unit) and extend the e2e tests.

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
2. `src/config/configuration.ts` — extend `AppConfig` and map it.
3. `.env.example` — document it.
4. `k8s/configmap.yaml` — add it when the production value must differ from the default.
