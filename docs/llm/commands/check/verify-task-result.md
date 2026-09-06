# Verify Task Result

## Determine Changed Files

Collect all locally changed files:

`dev` is the branch PRs target ([github.md](../../rules/github.md#branch-flow)).

```bash
git diff origin/dev...HEAD --name-only
git diff --name-only
git diff --cached --name-only
```

Deduplicate and use the combined list.

## Step 1 — Quick checks (always)

| Changed files | Command                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `.ts`         | `npx eslint <files> --no-fix`                                                               |
| `.ts`         | `npx tsc --noEmit`                                                                          |
| `*.spec.ts`   | `npx jest <test-file>`                                                                      |
| any           | `npm run format:check` — if fails, run `npx prettier --write <failing-files>`, then recheck |

Report ✅ pass or ❌ fail with relevant error output.

## Step 2 — Full checks

All commands are read-only and safe — no approval needed. Run for the final verification of a task (workflow's completion checklist) or when asked for "full checks"; skip for quick mid-task iterations.

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:e2e`
5. `npm run build`

## Completion claims

Report only what a command printed in this session, with the actual numbers
(`X passed, Y failed, Z skipped`) — never "should work" / "seems to pass".

## Output

```
✅ eslint (changed files)
✅ tsc
✅ tests (changed files)
✅ format:check
--- full ---
✅ typecheck
✅ lint
✅ unit
✅ e2e
✅ build
```
