# GitHub Workflow & Conventions

## Language

- **English** — everything on GitHub: PR titles/descriptions, commit messages,
  issue titles/bodies, and code comments.
- **Russian** — only owner-facing planning docs (`docs/PRODUCT.md`,
  `docs/PRODUCT_PLAN.md`).

## Branch Flow

- Branch off `dev`; never commit straight to `dev` or `main`.
- PRs target `dev`. Promote `dev → main` only after testing on `dev`.
- One PR may bundle several steps — keep them as separate, focused commits.

## Commits & PR Text

- Message format → [../commands/git/rules/changes-message-format-rules.md](../commands/git/rules/changes-message-format-rules.md).
- Generate a commit with `/git-commit`, a PR description with `/pr-description`.

## PR Lifecycle

1. Push the branch, open the PR against `dev` (`gh pr create --base dev`).
2. Wait for required CI checks (`gh pr checks <n> --watch`).
3. Merge and delete the branch (`gh pr merge <n> --merge --delete-branch`).

## Approval

Commit, push, and merge only with explicit user approval — the owner reviews
local diffs first (see [../commands/git/commit-local-changes.md](../commands/git/commit-local-changes.md)).
A broad "do what you think is right" is not commit approval.
