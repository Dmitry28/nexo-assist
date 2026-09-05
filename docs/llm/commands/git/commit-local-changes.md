# Commit Staged Changes

Generate a commit message and **propose** the command — never run `git commit` yourself
([github.md § Approval](../../rules/github.md#approval)).

## Prerequisites

1. Run `git diff --cached --name-only`.
2. If no staged changes → **STOP**: "No staged changes to commit".
3. **Never suggest `git add`** — the user decides what is staged.
4. Run `/verify-task-result` (format check, lint, type check, tests). Fix any failures first.

## Instructions

1. Generate the message per [rules/changes-message-format-rules.md](rules/changes-message-format-rules.md).
2. Format: `git commit -m "<type>: <message>"` — **never HEREDOC**.

## Output

Only the git commit command in a code block. No explanations.

## After the user runs it

Compare `git show --stat HEAD` against the staged set. The pre-commit hook (`lint-staged`) stashes
and restores the working tree, and a **modified** (not newly added) file it reformats can land back
in the working tree instead of the commit — a partial commit that looks successful. Missing files →
`git add` them and `git commit --amend --no-edit`.
