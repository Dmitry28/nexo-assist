# Contributing

The canonical rules live in [`docs/llm/`](docs/llm/) — single source of truth for humans **and** AI agents. This page is the index.

## Workflow

```bash
git checkout -b feat/<short-name>
# ...changes...
npm run lint && npm run typecheck && npm test
git push -u origin feat/<short-name>
gh pr create
```

CI must be green before merge. Default merge: `gh pr merge --squash --delete-branch`.

Full loop (Plan → Implement → Verify → Fix): [`docs/llm/rules/workflow.md`](docs/llm/rules/workflow.md).

## Commit & PR messages

[Conventional Commits](https://www.conventionalcommits.org). Types and PR description format: [`docs/llm/commands/git/rules/changes-message-format-rules.md`](docs/llm/commands/git/rules/changes-message-format-rules.md).

## Code rules

- Architecture (module structure, layer responsibilities, env vars): [`docs/llm/rules/architecture.md`](docs/llm/rules/architecture.md).
- Code style: [`docs/llm/rules/code-style.md`](docs/llm/rules/code-style.md).
- TypeScript (strict, no `as`, `import type`): [`docs/llm/rules/typescript.md`](docs/llm/rules/typescript.md).
- Review (CCR labels): [`docs/llm/rules/code-review.md`](docs/llm/rules/code-review.md).

## Tests

- Every service gets `*.service.spec.ts` (unit).
- Cover new endpoints in `test/app.e2e-spec.ts`.
- Test error paths (404/409/429…), not just the happy path.
