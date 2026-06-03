# Contributing

## Workflow

1. Branch off `main`: `git checkout -b feat/<short-name>`.
2. Make your change. Mirror the `users` module for new features (see `CLAUDE.md`).
3. Run the gate locally before pushing:
   ```bash
   npm run lint && npm run typecheck && npm test
   ```
4. Open a PR. CI must be green and the PR description filled in.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):

```
feat(users): add email verification
fix(health): correct readiness threshold
chore(deps): bump nestjs to 11.1
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.

## Code standards

- Strict TypeScript; no `any`, no unused locals/params.
- Prettier owns formatting; ESLint owns correctness — both run on pre-commit and in CI.
- Every service gets a `*.service.spec.ts`; cover new endpoints in `test/app.e2e-spec.ts`.
- Test error paths (404/409/429…), not just the happy path.

## Adding env vars

Update **all three**: `src/config/env.validation.ts` (schema), `.env.example`, and the
`AppConfig` mapping in `src/config/configuration.ts`. The app fails to boot on invalid config.
