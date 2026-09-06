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

Full `src/` layout and layer rules → [rules/architecture.md](rules/architecture.md#project-structure).
What isn't visible from the tree:

- `src/tracing.ts` must stay the **first** import in `main.ts` (OpenTelemetry patches modules on load).
- `src/config/env.validation.ts` is the single source of env defaults — the app fails fast on boot.
- `src/app.setup.ts` (`configureApp()`) is shared by `main.ts` and e2e, so tests hit production routes.

## Core Rules

- **Top rule — every change:** correct, simple, clear, concise, DRY; follow established best practices, patterns and standards. This outranks everything below ([rules/development-philosophy.md § Self-Check](rules/development-philosophy.md#self-check) applies it).
- **Decide, don't ask.** When a question comes up, investigate it yourself first (code, docs, live checks) and decide by common sense, standards and best practices. Ask the owner only what is genuinely important: product direction, destructive/irreversible actions, trade-offs only he can weigh.
- **No over-engineering.** Don't anticipate futures; don't add abstractions before a second consumer exists.
- **Fix it or log it — never walk past it.** Noticed a real problem outside the current scope? Verify it's real (read the code), then: **`[H]` only — critical correctness or security — gets fixed now.** Anything else gets a marker and you move on: a `TODO [H|M|L]` at the code it affects ([rules/code-style.md](rules/code-style.md#comments)), or an entry in the «Технический бэклог» of [docs/PRODUCT_PLAN.md](../PRODUCT_PLAN.md) when it's bigger than a comment. This applies to review findings too — a pile of `[L]`s must not stall the task it was reviewing.
- **Nothing important lives only in chat.** Anything worth knowing later — a decision and its reasoning, a non-obvious constraint, a diagnosis, a workaround, an incident and its fix — must land somewhere durable **in the same change**: the right doc (see the Project Docs table) or a `NOTE:`/comment at the code it constrains (format: [rules/code-style.md](rules/code-style.md)). Rule of thumb: if the next person (or the next session) would ask "why is this like that?" — write it down where they'll look.
- Follow existing NestJS module structure — mirror an existing module (`subscriptions`, `telegram`).
- **Talk plainly.** Concise, facts only, no filler; mark assumptions and anything unverified. Narrate **every step, not just the whole task**: before it, what you're doing and _why_; after it, _what_ changed, _why_, and how you verified — in language a non-implementer follows, never a diff dump.
- **Teach as you go.** The owner is new to DevOps/infra, so every infra, deploy, k8s, network or security step comes with the **concept in simple words** (what it is, why we need it, what breaks without it), and every diagnosis shows the reasoning (symptom → what it means → fix). Plain analogies over jargon; if an explanation didn't land, re-explain simpler. Durable versions live in [DEPLOY.md](../DEPLOY.md).
- **Never commit or merge without the owner's review** — show the diff + a plain summary, then
  wait. Code, manifests, configs, docs all count. Push and open the PR freely; never
  auto-merge. Why, and where the line falls: [rules/github.md § Approval](rules/github.md#approval).
- Reviewing a PR or changes → `/logic-review` **and** `/review-code` (the skills, launched together), not a manual pass. **Both only report** — they never edit; applying a finding is a normal change you show for review.
- Repo-specific lessons (conventions, patterns, gotchas) belong in `docs/llm/` — not personal memory.
- **Keep docs current:** update **every** doc a change affects, in the same change — see the Project Docs table above for which is which: [PRODUCT.md](../PRODUCT.md) (behavior), [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) (roadmap/decisions), [PRODUCT_TECH.md](../PRODUCT_TECH.md) (infra/runtime reality), [DEPLOY.md](../DEPLOY.md) (deploy steps + lessons), [README.md](../../README.md) (scripts, setup, commands, stack), and the relevant `docs/llm/` rule when a convention changes.

## Reference Repos (local)

Read before inventing something we already solved elsewhere. All three are local checkouts.
Paths are written home-relative (`~/…`) on purpose: **the repo is public**, and a full
`/Users/<name>/…` path publishes the owner's username. Same rule anywhere in the repo.

| Repo                        | Go there for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/dp/my/land-scraper`      | **The prototype — the reference for source plugins.** `src/modules/` holds 12 working source modules (kufar ×3, realt, av-by, bamper, bid-cars, ghb, land-auctions, mosty-jobs, pogorany, townhouses): selectors, pagination, price normalization, fixtures. Adding an adapter here starts by reading its counterpart there. Also the source of the kufar search-API approach and the Puppeteer/scrapfly path for Cloudflare sites. What to port — [PRODUCT_PLAN.md §5](../PRODUCT_PLAN.md). |
| `~/dp/enneo/enneo/io-proxy` | Mature **NestJS backend** — the closest match to this repo. Approaches and conventions: `docs/llm/` (its own ENTRY_POINT + `rules/` + `commands/`, the structure ours mirrors), `docs/architecture/`, `docs/patterns/` (e.g. security boundaries), `docs/services/`, plus `eslint.config.mjs`, `knip.json`, `Taskfile.yml`.                                                                                                                                                                  |
| `~/dp/enneo/enneo/ops-fe`   | Mature **Next.js frontend** — take the process, not the stack: `docs/llm/` rules and commands, `docs/patterns/`, `docs/implementation-plans/` (how a change gets planned before it is written), `_plugins/` (custom eslint/stylelint rules), tooling configs. Relevant when the admin dashboard (Phase 10) starts.                                                                                                                                                                           |

Borrow the approach, not the code: those repos carry their own constraints. Anything adopted from
them still follows this repo's rules and lands with its docs updated.

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
| Context budget         | [rules/context-budget.md](rules/context-budget.md)                 |
| Testing                | [rules/testing.md](rules/testing.md)                               |
| Dependencies           | [rules/dependencies.md](rules/dependencies.md)                     |
| Observability          | [rules/observability.md](rules/observability.md)                   |
| Workflow               | [rules/workflow.md](rules/workflow.md)                             |
| Step-by-step flow      | [rules/step-by-step-flow.md](rules/step-by-step-flow.md)           |
| GitHub workflow        | [rules/github.md](rules/github.md)                                 |
| LLM skills             | [rules/llm-skills-guide.md](rules/llm-skills-guide.md)             |
