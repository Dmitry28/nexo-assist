# Code Review Rules

## Comment Labels (CCR)

| Label | Severity                                          | SA required |
| ----- | ------------------------------------------------- | ----------- |
| `[H]` | Critical — must be fixed before merging           | Yes         |
| `[M]` | Major                                             | Yes         |
| `[L]` | Minor                                             | Yes         |
| `[D]` | Discuss — surface for a call                      | No          |
| `[Q]` | Question — informational                          | No          |

**SA** (Suggested Action) — a concrete fix suggestion, required for `[H]`, `[M]`, `[L]`.

## What to Check

- **Architecture** — correct layer (controller/service/module), no cross-module reach-through, follows `architecture.md`.
- **TypeScript** — no `as` assertions, proper DTO types, no `any`, `import type` for type-only.
- **NestJS** — business logic in services not controllers, `ConfigService` not `process.env`, DTOs validated, no leaked ORM/persistence types through the API.
- **Code style** — naming conventions, constants for magic values, object params for 2+ args.
- **Security** — no secrets in code, input validated via DTOs, no string-interpolated SQL.
- **DRY / Simplicity** — no duplicated defaults, no speculative abstractions, no dead code, no over-engineering.

## Output Format

Group by file. Skip files with no issues.

```
## Review

### `path/to/file.ts`
- [H] Description of the issue
  SA: Concrete fix

- [L] Minor style issue
  SA: How to fix
```

If no issues found: `✅ No issues found`
