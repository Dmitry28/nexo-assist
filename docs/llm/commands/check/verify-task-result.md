# Verify Task Result

## Determine Changed Files

Collect all locally changed files:

```bash
git diff origin/main..HEAD --name-only
git diff --name-only
git diff --cached --name-only
```

Deduplicate and use the combined list.

## Step 1 — Quick checks (no approval needed)

| Changed files | Command                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `.ts`         | `npx eslint <files> --no-fix`                                                               |
| `.ts`         | `npx tsc --noEmit`                                                                          |
| `*.spec.ts`   | `npx jest <test-file>`                                                                      |
| any           | `npm run format:check` — if fails, run `npx prettier --write <failing-files>`, then recheck |

Report ✅ pass or ❌ fail with relevant error output.

## Step 2 — Full checks (ask approval first)

Ask: **"Run full lint and tests? This may take a moment."**

If approved:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:e2e`
5. `npm run build`

## Completion claims

- **Never claim "everything works" without fresh run evidence from this session.**
- Forbidden in conclusions: "should work", "probably fine", "seems to pass".
- State actual numbers: `X passed, Y failed, Z skipped`.

## Output

```
✅ eslint (changed files)
✅ tsc
✅ tests (changed files)
✅ format:check
--- approved ---
✅ typecheck
✅ lint
✅ unit
✅ e2e
✅ build
```
