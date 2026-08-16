# /refine

Target: the work just produced. Default — every file changed vs `origin/main` (committed +
staged + unstaged); if the user named an artifact (a doc, plan, PR description), that one instead.

```bash
git diff origin/main..HEAD --name-only
git diff --name-only
git diff --cached --name-only
```

Apply both passes and the output format from [rules/refine.md](../../rules/refine.md).
