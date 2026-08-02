# Project Entry Point

## About

**nexo-assist** — a Telegram listing-watch bot (kufar/realt and more) on a NestJS 11 base. New features live in `src/modules/<feature>/`, mirroring an existing module. Product spec: [docs/PRODUCT.md](../PRODUCT.md).

## Project Docs (`docs/`)

| Doc                                   | What it holds — read it when…                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PRODUCT.md](../PRODUCT.md)           | **What** the product does: user-facing behavior, bot commands, delivery rules. Update when behavior changes.                                                                                                                              |
| [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) | **Where we're going**: phases/roadmap, decisions table, tech backlog. Update when scope, order or a decision changes.                                                                                                                     |
| [PRODUCT_TECH.md](../PRODUCT_TECH.md) | **What runs where**: runtime topology (app on Hetzner/k3s, DB on Supabase, kufar proxy on Oracle), infra decisions, constraints, config/secret inventory, costs. Update when infrastructure changes. No secrets/IPs — the repo is public. |
| [DEPLOY.md](../DEPLOY.md)             | **How to deploy + DevOps learning guide**: concepts explained plainly, per-file breakdown, provisioning runbook, troubleshooting, incident lessons. Update after each deploy step.                                                        |
| [llm/](.)                             | Instructions for LLMs: this entry point + `rules/` (conventions) + `commands/`.                                                                                                                                                           |

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
npm run check:dead-code # knip — unused files/exports/dependencies
```

Before claiming a change is done, run: `npm run lint && npm run typecheck && npm test`.

## Key Files

- `package.json` — dependencies and scripts (NestJS 11, class-validator, helmet, throttler, swagger, terminus, pino, prometheus, opentelemetry).
- `src/main.ts` — bootstrap (logger, Swagger, shutdown hooks, fatal handlers, listen).
- `src/app.setup.ts` — `configureApp()`: helmet, CORS, prefix, URI versioning; shared by `main.ts` and e2e.
- `src/tracing.ts` — OpenTelemetry init (must stay the first import in `main.ts`).
- `src/app.module.ts` — root module (Config, Logger, Throttler, Prometheus, Health, global filter + guard).
- `src/config/configuration.ts` — typed `AppConfig` exposed under `app.*`.
- `src/config/env.validation.ts` — class-validator schema; single source of defaults; fail-fast on boot.
- `src/modules/sources/` — source-plugin layer (`SourceAdapter` + `SourceRegistry`).
- `src/modules/subscriptions/`, `src/modules/telegram/` — domain + bot feature modules.

## Core Rules

- **Top rule — every change:** correct, simple, clear, concise, DRY; follow established best practices, patterns and standards. This outranks everything below.
- **Decide, don't ask.** When a question comes up, investigate it yourself first (code, docs, live checks) and decide by common sense, standards and best practices. Ask the owner only what is genuinely important: product direction, destructive/irreversible actions, trade-offs only he can weigh.
- **No over-engineering.** Don't anticipate futures; don't add abstractions before a second consumer exists.
- **Log tech debt.** Spot over-complicated code you're not refactoring now → add it to the «Технический бэклог» in [docs/PRODUCT_PLAN.md](../PRODUCT_PLAN.md) so it isn't lost.
- **Nothing important lives only in chat.** Anything worth knowing later — a decision and its reasoning, a non-obvious constraint, a diagnosis, a workaround, an incident and its fix — must land somewhere durable **in the same change**: the right doc (see the Project Docs table) or a `NOTE:`/comment at the code it constrains (format: [rules/code-style.md](rules/code-style.md)). Rule of thumb: if the next person (or the next session) would ask "why is this like that?" — write it down where they'll look.
- Follow existing NestJS module structure — mirror an existing module (`subscriptions`, `telegram`).
- **Talk to the user concisely** — clear, to the point, no filler. State facts only; explicitly mark assumptions and anything not yet verified.
- **Explain purpose, plainly.** Before acting, say _why_ (what problem it solves / what it enables). When done, say _what_ changed and _why_ in plain language a non-implementer follows — the intent and effect, not a diff dump. File/line detail is a supplement, never the whole report.
- **Teach, don't just instruct.** The owner is new to DevOps/infra — every infra, deploy, k8s, network or security step comes with the **concept in simple words**: what this thing is, why we need it, what breaks without it. Prefer plain analogies over jargon; when a diagnosis happens, show the reasoning (symptom → what it means → fix) so the skill transfers. If an explanation didn't land, re-explain simpler instead of repeating it. Durable versions of these explanations live in [DEPLOY.md](../DEPLOY.md).
- **Never commit without the owner's review.** Implement → show the diff + a plain-language summary → wait for explicit approval → commit. This applies to **everything** — code, manifests, configs **and documentation** (no "it's just docs" exception). Same for push/merge.
- Reviewing a PR or changes → `/logic-review` then `/review-code` (the skills, in that order), not a manual pass.
- Repo-specific lessons (conventions, patterns, gotchas) belong in `docs/llm/` — not personal memory.
- **Keep docs current:** update **every** doc a change affects, in the same change — see the Project Docs table above for which is which: [PRODUCT.md](../PRODUCT.md) (behavior), [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) (roadmap/decisions), [PRODUCT_TECH.md](../PRODUCT_TECH.md) (infra/runtime reality), [DEPLOY.md](../DEPLOY.md) (deploy steps + lessons), [README.md](../../README.md) (scripts, setup, commands, stack), and the relevant `docs/llm/` rule when a convention changes.

## Reference Repos (local)

- `/Users/dmitrypoluy/dp/my/land-scraper` — the prototype; logic to port here (see [PRODUCT_PLAN.md §5](../PRODUCT_PLAN.md)).
- `/Users/dmitrypoluy/dp/enneo/enneo/ops-fe` and `/Users/dmitrypoluy/dp/enneo/enneo/io-proxy` — mature repos to borrow from: technical solutions, approaches, LLM instructions, eslint/tooling configs.

## Workflow

Follow the [Workflow Loop](rules/workflow.md) for every task: Plan → Implement → Verify → Fix.

## Quick Reference

| Topic                  | Doc                                                                |
| ---------------------- | ------------------------------------------------------------------ |
| Code style             | [rules/code-style.md](rules/code-style.md)                         |
| TypeScript             | [rules/typescript.md](rules/typescript.md)                         |
| Architecture           | [rules/architecture.md](rules/architecture.md)                     |
| Development philosophy | [rules/development-philosophy.md](rules/development-philosophy.md) |
| Code review            | [rules/code-review.md](rules/code-review.md)                       |
| Logic review           | [rules/logic-review.md](rules/logic-review.md)                     |
| Debugging              | [rules/debugging.md](rules/debugging.md)                           |
| Testing                | [rules/testing.md](rules/testing.md)                               |
| Workflow               | [rules/workflow.md](rules/workflow.md)                             |
| Step-by-step flow      | [rules/step-by-step-flow.md](rules/step-by-step-flow.md)           |
| GitHub workflow        | [rules/github.md](rules/github.md)                                 |
| LLM skills             | [rules/llm-skills-guide.md](rules/llm-skills-guide.md)             |
