# nexo-assist

Production-ready [NestJS](https://nestjs.com) skeleton. Opinionated, batteries-included
starting point for building real modules: validated config, structured logging, global
error handling, request validation, OpenAPI docs, health checks, and a full lint/format/test
pipeline.

## Stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | NestJS 11 (Express)                                 |
| Language       | TypeScript 5 (strict)                               |
| Config         | `@nestjs/config` + `class-validator` env validation |
| Logging        | `nestjs-pino` (pretty in dev, JSON in prod)         |
| Validation     | `class-validator` / `class-transformer`             |
| API docs       | `@nestjs/swagger` (OpenAPI)                          |
| Health         | `@nestjs/terminus` (liveness + readiness)           |
| Rate limiting  | `@nestjs/throttler`                                 |
| Metrics        | `@willsoto/nestjs-prometheus` (`/metrics`)          |
| Tracing        | OpenTelemetry (OTLP, opt-in)                        |
| Security       | `helmet`, CORS, `compression`                       |
| Tests          | Jest (unit) + Supertest (e2e)                        |
| Lint / Format  | ESLint 9 (flat config) + Prettier 3                 |
| Git hooks      | Husky + lint-staged                                 |
| CI             | GitHub Actions                                      |
| Container      | Multi-stage Dockerfile + docker-compose             |
| Orchestration  | Kubernetes manifests (Kustomize)                    |

## Requirements

- Node.js >= 20 (see `.nvmrc` → 22)
- npm

## Getting started

```bash
npm install
cp .env.example .env
npm run start:dev
```

- API base URL: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/docs` (non-production only)
- Liveness: `http://localhost:3000/api/v1/health/live`
- Readiness: `http://localhost:3000/api/v1/health/ready`
- Metrics (Prometheus): `http://localhost:3000/api/v1/metrics`

## Scripts

| Script                 | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run start:dev`    | Run with watch mode                      |
| `npm run start:prod`   | Run compiled output (`dist/main`)        |
| `npm run build`        | Compile to `dist/`                       |
| `npm run lint`         | ESLint (fails on warnings)               |
| `npm run lint:fix`     | ESLint with autofix                      |
| `npm run format`       | Prettier write                           |
| `npm run format:check` | Prettier check (CI)                      |
| `npm run typecheck`    | `tsc --noEmit`                           |
| `npm test`             | Unit tests                               |
| `npm run test:cov`     | Unit tests with coverage                 |
| `npm run test:e2e`     | End-to-end tests                         |

## Project structure

```
src/
├── main.ts                  # Bootstrap: middleware, pipes, versioning, Swagger, throttler
├── tracing.ts               # OpenTelemetry init (imported first; opt-in via env)
├── app.module.ts            # Root module: config, logger, throttler, metrics, global filter
├── config/
│   ├── configuration.ts     # Typed, namespaced config (app.*)
│   └── env.validation.ts    # Env schema — app refuses to boot if invalid
├── common/                  # Cross-cutting building blocks
│   ├── dto/                 # Pagination request/response DTOs
│   └── filters/             # Global exception filter (consistent error JSON)
├── health/                  # Liveness + readiness probes (Terminus)
└── modules/
    └── users/               # Reference feature module (copy this shape)
        ├── dto/             # Request DTOs (create/update)
        ├── entities/        # API-facing models
        ├── users.controller.ts
        ├── users.service.ts # In-memory store — swap for a DB repo
        └── users.module.ts

k8s/                         # Kubernetes manifests (Kustomize)
docker-compose.yml           # Local stack
```

## Adding a new module

Mirror `src/modules/users`:

1. `nest g resource modules/<name>` (or copy the folder manually).
2. Define request DTOs with `class-validator` decorators + `@ApiProperty`.
3. Keep the API-facing entity separate from any future persistence model.
4. Throw Nest HTTP exceptions (`NotFoundException`, etc.) — the global filter formats them.
5. Register the module in `app.module.ts`.
6. Add a `*.service.spec.ts` and extend the e2e suite.

## Configuration

All environment variables are declared and validated in `src/config/env.validation.ts`.
Copy `.env.example` to `.env` and adjust. Invalid/missing values fail fast at startup.

## Observability

- **Metrics** — Prometheus scrape endpoint at `/api/v1/metrics` (default Node/process
  metrics included). Add custom counters/histograms via `@willsoto/nestjs-prometheus`.
- **Tracing** — OpenTelemetry, opt-in. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (and optionally
  `OTEL_SERVICE_NAME`) to start the SDK; auto-instruments HTTP/Express. See `src/tracing.ts`.
- **Logs** — structured JSON via `nestjs-pino` (pretty in dev), with request correlation IDs.

## Rate limiting

Global via `@nestjs/throttler` (`THROTTLE_TTL` / `THROTTLE_LIMIT`). Exempt a route or
controller with `@SkipThrottle()` (health probes already are); tighten a specific route
with `@Throttle({ default: { ttl, limit } })`.

## Docker

```bash
# Single image
docker build -t nexo-assist .
docker run -p 3000:3000 --env-file .env nexo-assist

# Local stack (app + room for postgres/redis)
docker compose up --build
```

Multi-stage build, runs as non-root, ships only production dependencies, with a `HEALTHCHECK`.

## Kubernetes

Manifests live in `k8s/` (Kustomize). See `k8s/README.md`.

```bash
kubectl apply -k k8s/
```

Includes liveness/readiness/startup probes, resource requests+limits, HPA (2→10),
non-root + read-only-rootfs security context, and Prometheus scrape annotations.

## Conventions

- Strict TypeScript; no unused locals/params.
- Prettier owns formatting; ESLint owns correctness. Both run in CI and on pre-commit.
- Path alias `@/*` → `src/*`.
- Routes are versioned via URI: `/api/v1/...`.
