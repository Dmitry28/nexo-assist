# Commit Staged Changes

Commit a diff the owner has approved ([github.md § Approval](../../rules/github.md#approval)).
No approval yet → stop and show the diff instead.

## Prerequisites

1. The caller stages exactly the approved files before invoking this (the fork does not know which
   were approved). Run `git diff --cached --name-only`.
2. If no staged changes → **STOP**: "No staged changes to commit".
3. Run `/verify-task-result` (format check, lint, type check, tests). Failures → stop and report:
   a fix is a new diff that needs its own approval.

## Instructions

1. Generate the message per [rules/changes-message-format-rules.md](rules/changes-message-format-rules.md).
2. Run `git commit -m "<type>: <message>"` — **never HEREDOC**.

## After committing

Compare `git show --stat HEAD` against the staged set. The pre-commit hook (`lint-staged`) stashes
and restores the working tree around its formatters, and a file can land back in the working tree
instead of the commit — a partial commit that reports success (observed 2026-09-08: an edit to an
unstaged file made between `git add` and `git commit` was lost). Missing files → `git add` them and
`git commit --amend --no-edit`.
