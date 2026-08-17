# Generate PR Description

Generate GitHub PR title and description for all changes in current branch.

**In English** — see [rules/github.md § Language](../../rules/github.md#language).

## What to Analyze

1. **Branch info:** `git branch --show-current`
   NOTE: two dots for `log`, three for `diff` — they are different operators. `log A...B` is the
   symmetric difference and would list commits merged into `dev` after this branch started.

2. **All commits:** `git log origin/dev..HEAD --no-merges --format="%s%n%b%n---"`
3. **All code changes:** `git diff origin/dev...HEAD --stat` and `git diff origin/dev...HEAD`
4. **Conversation history** for context.

## Output Format

Follow [changes-message-format-rules.md](rules/changes-message-format-rules.md) for the PR description format.

**PR Title:** `<type>: <brief description>` — lowercase, imperative mood, max 70 chars.

## Output Rules

- NO explanations or process descriptions.
- Output ONLY the PR title and description in a markdown code block.
- Follow Conventional Commits types: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `ci`, `build`, `perf`, `style`.
- Focus on outcomes, not implementation details.
- Skip a section entirely if there's nothing to put there.
