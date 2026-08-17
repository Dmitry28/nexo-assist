# Review Code

Review code changes using team CCR rules.

## What to Analyze

All changes in branch vs `origin/main`. **Always base the review on fresh `git diff` output — never review from memory.**

```bash
git diff origin/main..HEAD --name-only
git diff origin/main..HEAD
```

For § Whole-Change Pass, also **read the changed files in full** — that pass judges the final
state as a whole, which a diff cannot show.

## Rules

Apply all rules from [docs/llm/rules/code-review.md](../../rules/code-review.md).

## Output

No explanations, only the review output.
