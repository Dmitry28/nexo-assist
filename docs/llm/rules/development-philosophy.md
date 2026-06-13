# Development Philosophy

## Core Principles

- DRY, KISS, SOLID, YAGNI
- Type safety and static analysis
- Always follow existing patterns and code style in the codebase
- If the user's proposed approach has significant trade-offs or risks — raise them **before** implementing, not after
- **No guessing.** Back every technical claim with Read/Grep, a command, or fetched docs. Before asserting, self-check: "verified now, or recalled?" — if recalled, verify or say "not verified". If a fact can't be verified and blocks the task — ask the user instead of guessing.

## Self-Check

Apply after every iteration, after editing any `.md`, and during code review:

- **Simple** — prefer the least complex approach that does the job.
- **Clear** — next reader gets intent without a comment.
- **Concise** — cut anything that doesn't add meaning.
- **DRY** — single source for any duplicated logic, constant, or prose.

## Before Adding New Code — Check in This Order

1. **Search the codebase** — reuse existing functionality (the `users` module is the reference shape).
2. **Check `package.json`** — use already installed packages before adding new ones.
3. **Search npm** — only if nothing fits internally.

## No Over-Engineering

- A simple solution that fits the current need beats a flexible one that anticipates futures.
- Don't introduce abstractions until the second concrete consumer exists.
- Don't add error handling for paths that can't happen; trust internal invariants.
