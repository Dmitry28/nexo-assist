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

- Node.js >= 22 (see `.nvmrc`)
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
├── main.ts                  # Bootstrap: logger, Swagger, shutdown hooks, fatal handlers
├── app.setup.ts             # configureApp(): helmet, CORS, prefix, versioning (shared with e2e)
├── tracing.ts               # OpenTelemetry init (imported first; opt-in via env)
├── app.module.ts            # Root module: config, logger, throttler, metrics, global filter
├── config/
│   ├── configuration.ts     # Typed, namespaced config (app.*)
│   └── env.validation.ts    # Env schema — app refuses to boot if invalid
├── common/                  # Cross-cutting building blocks
│   ├── dto/                 # Pagination request/response DTOs
│   └── filters/             # Global exception filter (consistent error JSON)
├── health/                  # Liveness + readiness probes (Terminus)
├── metrics/                 # Prometheus controller (exempt from rate limiting)
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

Mirror `src/modules/users/`. Full checklist:
[`docs/llm/rules/architecture.md`](docs/llm/rules/architecture.md).

## Configuration

All environment variables are declared and validated in `src/config/env.validation.ts`.
Copy `.env.example` to `.env` and adjust. Invalid/missing values fail fast at startup.

## Observability

- **Metrics** — Prometheus scrape endpoint at `/api/v1/metrics` (default Node/process
  metrics included). Add custom counters/histograms via `@willsoto/nestjs-prometheus`.
- **Tracing** — OpenTelemetry, opt-in. Set `OTEL_EXPORTER_OTLP_ENDPOINT` (and optionally
  `OTEL_SERVICE_NAME`) to start the SDK; auto-instruments HTTP/Express. See `src/tracing.ts`.
  Control sampling without code changes via standard env: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`
  + `OTEL_TRACES_SAMPLER_ARG=0.1`. Unhandled 5xx exceptions are attached to the active span
  by the global exception filter.
- **Logs** — structured JSON via `nestjs-pino` (pretty in dev), with request correlation IDs.
  When tracing is enabled, `trace_id`/`span_id` are injected into every log line, so logs
  and traces cross-link in the APM.

## Rate limiting

Global via `@nestjs/throttler` (`THROTTLE_TTL` / `THROTTLE_LIMIT`). Exempt a route or
controller with `@SkipThrottle()` (health probes and `/metrics` already are); tighten a
specific route with `@Throttle({ default: { ttl, limit } })`.

Clients are keyed by `req.ip`; `trust proxy` is set to the first hop (see `app.setup.ts`)
so the real client IP survives a k8s ingress / load balancer. Adjust it if you add more
proxy layers (e.g. a CDN in front of the ingress).

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
