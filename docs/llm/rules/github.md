# GitHub Workflow & Conventions

## Language

- **English** — everything on GitHub (PR titles/bodies, commit messages, issue text, review
  comments), all code and comments, `README.md`, `docs/PRODUCT.md` and all of `docs/llm/`.
  The repo is public; its readers are other developers.
- **Russian** — exactly three owner-facing docs, because the owner reads them while learning:
  [PRODUCT_PLAN.md](../../PRODUCT_PLAN.md), [PRODUCT_TECH.md](../../PRODUCT_TECH.md),
  [DEPLOY.md](../../DEPLOY.md). Nothing else.

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
