# Development Philosophy

## Core Principles

DRY, KISS, SOLID, YAGNI — applied in § Self-Check below.

- If the user's proposed approach has significant trade-offs or risks — raise them **before** implementing, not after
- **Acceptance criteria state the problem, not the solution.** They are drafted without reading the
  code, so the wording can be wrong even when the pain is real. Build the simplest thing that
  actually fixes it; where that diverges from the stated criterion, do the better thing and say so
  in the PR. A named constraint (contract, security rule) still binds.
- **Generic, for every user** (owner, 2026-10-19). The bot is a product for many users, not the
  owner's script: no behaviour, text, limit or shortcut tailored to the owner's subscriptions or
  one site. Shared behaviour lives in shared code, a site's knowledge in its source definition
  (`item`, `protection`…). Not a licence for abstractions ahead of need — § Self-Check's _Lean_
  still decides _when_; this decides _for whom_.
- **No guessing.** Back every technical claim with Read/Grep, a command, or fetched docs. Before asserting, self-check: "verified now, or recalled?" — if recalled, verify or say "not verified". If a fact can't be verified and blocks the task — ask the user instead of guessing.

## Self-Check

Apply after every iteration, after editing any `.md`, and during code review:

- **Simple (KISS)** — prefer the least complex approach that does the job.
- **Clear** — next reader gets intent without a comment.
- **Concise** — cut anything that doesn't add meaning.
- **DRY** — single source for any duplicated logic, constant, or prose.
- **Lean (YAGNI)** — fits the current need, not anticipated futures; no abstraction before a second consumer; no error handling for paths that can't happen.
- **Idiomatic** — follows established best practices, patterns and standards; matches peer code.
