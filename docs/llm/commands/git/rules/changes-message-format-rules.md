# Git Message Format Guide

Based on [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

## Common Rules

- **English only** — commit messages, PR titles and bodies, issue text, review comments.
  The repo is public and its audience is other developers; the owner-facing Russian docs are
  listed in [github.md § Language](../../../rules/github.md#language).
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
<type>(<scope>): <description>
```

- Scope is optional but usual here — it names the touched area (`telegram`, `plan`, `llm`,
  `deploy`). Drop it only when a change genuinely spans the repo — as in the last example below.
- Max 100 characters.
- The header carries the change. Add a body only for a **why** the header can't hold — a
  non-obvious cause, a constraint that forced the approach. Impact lines belong to the PR
  description (§ 2), never to a commit.
- **One commit per decision** — not per edit, per file or per milestone. A merged message can't be
  rewritten, so it is worth getting right once.
- Don't restate what an earlier commit on the branch already said (`git log origin/dev..HEAD`).

### Examples

```
feat(telegram): publish the command menu and add /help
fix(subscriptions): handle 409 on duplicate user email
chore(deps): bump nestjs to 11.1
refactor: drop the unused legacy env vars
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

**No change for the audience → no impact line.** Pure refactoring, formatting, comments, log tweaks, file moves, internal types, lockfile updates — all skipped. If a change _looks_ like a refactor but breaks an API others use — it's not a refactor; list it with a migration note.

**Writing style (DRY):** combine related changes into single high-level statements; focus on outcome, not steps.
