# Generate PR Description

**In English** — see [rules/github.md § Language](../../rules/github.md#language).

## What to Analyze

1. **All commits:** `git log origin/dev..HEAD --no-merges --format="%s%n%b%n---"`
2. **All code changes:** `git diff origin/dev...HEAD --stat` and `git diff origin/dev...HEAD`
3. **Conversation history** for context.

NOTE: two dots for `log`, three for `diff` — they are different operators. `log A...B` is the
symmetric difference and would list commits merged into `dev` after this branch started.

## Output Format

Follow [changes-message-format-rules.md](rules/changes-message-format-rules.md) § 2 for the PR title and description.

## Output Rules

- NO explanations or process descriptions.
- Output ONLY the PR title and description in a markdown code block.
- Focus on outcomes, not implementation details.
- Skip a section entirely if there's nothing to put there.
