# Commit Staged Changes

**NEVER run `git commit` automatically. Always show the command and wait for explicit user approval first — the user must review changes before committing.**

Generate a commit message and propose the git commit command for user approval.

## Prerequisites

1. Run `git diff --cached --name-only`.
2. If no staged changes → **STOP**: "No staged changes to commit".
3. **DO NOT suggest `git add .` or any other git add commands.**
4. Run `/verify-task-result` (format check, lint, type check, tests). Fix any failures before proposing the commit.

## Instructions

1. Generate commit message following [rules/changes-message-format-rules.md](rules/changes-message-format-rules.md).
2. Format: `git commit -m "<type>: <message>"`.
3. **NEVER use HEREDOC syntax.**
4. **Propose the command — do NOT execute it automatically.**

## Output

Only the git commit command in a code block. No explanations.
