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

| Changed files | Command                       |
| ------------- | ----------------------------- |
| `.ts`         | `npx eslint <files> --no-fix` |
| `.ts`         | `npx tsc --noEmit`            |
| `*.spec.ts`   | `npx jest <test-file>`        |

Report ✅ pass or ❌ fail with relevant error output.

## Step 2 — Full checks (ask approval first)

Ask: **"Run full lint and tests? This may take a moment."**

If approved:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run test:e2e`
5. `npm run build`

## Output

```
✅ eslint (changed files)
✅ tsc
✅ tests (changed files)
--- approved ---
✅ typecheck
✅ lint
✅ unit
✅ e2e
✅ build
```
