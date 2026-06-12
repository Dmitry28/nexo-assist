# Logic Review

Review **feature behavior** — does the diff do what the task asks? Pick mode by `$ARGUMENTS`:

- **empty** → **Local mode** (current branch)
- **GitHub PR URL / number** → **Remote mode**

## Local Mode

Reviews **all** changes vs `origin/main` (committed + staged + unstaged):

```bash
git diff origin/main..HEAD
git diff --cached
git diff
```

Task source: the linked GitHub issue (`gh issue view <n>`), the PR description, or the plan agreed in conversation. If none is identifiable — ask the user what was agreed.

## Remote Mode

```bash
gh pr view <number> --json title,body,url
gh pr diff <number>
```

Extract the linked issue from the PR body (`#<n>`, `closes #<n>`); fetch it via `gh issue view <n>`.

## Rules

Apply all rules from [docs/llm/rules/logic-review.md](../../rules/logic-review.md).

## Output

Per `rules/logic-review.md` § Output Format — coverage receipt, AC traceability matrix, findings grouped by file, Improvement plan. Nothing else.
