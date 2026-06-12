# Git Message Format Guide

Based on [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

## Common Rules

- Use lowercase for all messages.
- Be clear and concise.
- Use imperative mood ("add feature" not "added feature").

## Types

- `feat` — new feature
- `fix` — bug fix
- `refactor` — code refactoring without behaviour change
- `perf` — performance improvement
- `style` — formatting only
- `test` — adding or updating tests
- `docs` — documentation
- `build` — build system or dependencies
- `ci` — CI/CD configuration
- `chore` — maintenance tasks
- `revert` — revert previous commit

## 1. Commit Message Format

```
<type>: <description>
```

- Max 100 characters.
- Header only for simple commits (no body needed).

### Examples

```
feat: add billing module with stripe integration
fix: handle 409 on duplicate user email
chore: bump nestjs to 11.1
test: add health endpoint e2e test
```

## 2. PR Description Format

```
## Summary

### User impact
- feat: what the user sees or can now do (skip if no user-facing changes)

### Technical impact
- refactor: architectural or internal changes
- build: dependency or tooling changes

## Test plan
- [ ] What to test manually
- [ ] Edge cases to verify
```

**User impact** — visible changes: new features, UI/API changes, bug fixes affecting behaviour.
**Technical impact** — what other developers should know: breaking APIs, new shared services, measurable performance wins, infra/build changes, dependency migrations, architectural patterns to follow.
Skip a section entirely if there's nothing to put there.

**No change for the audience → no impact line.** Pure refactoring, formatting, comments, log tweaks, file moves, internal types, lockfile updates — all skipped. If a change *looks* like a refactor but breaks an API others use — it's not a refactor; list it with a migration note.

**Writing style (DRY):** combine related changes into single high-level statements; focus on outcome, not steps.
