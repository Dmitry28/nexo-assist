# Review Code

Review code changes using team CCR rules. Mode by `$ARGUMENTS`:

- **empty** → **Local mode** — all changes vs `origin/dev` (committed + staged + unstaged)
- **GitHub PR URL / number** → **Remote mode** — that PR's diff
- **path / glob** (e.g. `src/modules/sources`) → **Scope mode** — every tracked file in the path,
  for a bulk audit rather than a diff

**Always base the review on fresh output — never review from memory.**

## Local Mode

```bash
git diff origin/dev...HEAD --name-only
git diff origin/dev...HEAD
git diff --cached
git diff
```

**Read-only: the review never restores, stashes or checks anything out.** `git checkout <sha> -- .`
and `git stash pop` destroy uncommitted work, and the stash stack is shared with every other
session — a `pop` here can take an entry that isn't yours.

## Remote Mode

```bash
gh pr view <n> --json title,body,headRefName,url
gh pr diff <n>
gh pr checks <n>
```

## Scope Mode

```bash
git ls-files -- <path-or-glob>
```

Skip the Process Checks rows that need a diff or PR artifacts (commit messages, PR title + body,
CI); routing, Pattern Check and Output Format are unchanged.

For § Whole-Change Pass, also **read the changed files in full** — that pass judges the final
state as a whole, which a diff cannot show.

## Rules

Apply all rules from [docs/llm/rules/code-review.md](../../rules/code-review.md).

## Before emitting the report

- **Every file in scope appears in the receipt** — a file that was not reviewed is the
  under-coverage `[H]`, not a silent drop.
- **Every cited `file:line` exists**, and for each `[H]` open the file and confirm the line really
  shows the cited pattern. A finding that cites the wrong line costs more than no finding.
- **Dedup** by `(file, label, first sentence)`.

## Output

No explanations, only the review output.
