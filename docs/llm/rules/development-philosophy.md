# Development Philosophy

## Core Principles

- DRY, KISS, SOLID
- Type safety and static analysis
- Always follow existing patterns and code style in the codebase
- If the user's proposed approach has significant trade-offs or risks — raise them **before** implementing, not after

## Before Adding New Code — Check in This Order

1. **Search the codebase** — reuse existing functionality (the `users` module is the reference shape).
2. **Check `package.json`** — use already installed packages before adding new ones.
3. **Search npm** — only if nothing fits internally.

## No Over-Engineering

- A simple solution that fits the current need beats a flexible one that anticipates futures.
- Don't introduce abstractions until the second concrete consumer exists.
- Don't add error handling for paths that can't happen; trust internal invariants.
