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
- PRs target `dev`. `main` is frozen and takes no part in the flow: it comes into use once
  there are two environments (`dev` → staging, `main` → prod). Until then nothing is promoted
  to `main` ([PRODUCT_PLAN.md](../../PRODUCT_PLAN.md), decisions → «Git-флоу»).
- One PR may bundle several steps — keep them as separate, focused commits.
- `dev` is the repository's **default branch** on GitHub, and must stay that way. Bots read
  their config from the default branch only: while `main` was default, the
  `.github/dependabot.yml` on `dev` — the one carrying `target-branch: dev` — was never read,
  and every dependency PR opened against the stale `main` instead
  ([PRODUCT_PLAN.md](../../PRODUCT_PLAN.md), tech backlog 2026-09-05).

## Commits & PR Text

- Message format → [../commands/git/rules/changes-message-format-rules.md](../commands/git/rules/changes-message-format-rules.md).
- Generate a commit with `/git-commit`, a PR description with `/pr-description`.

## PR Lifecycle

1. Push the branch, open the PR against `dev` (`gh pr create --base dev`).
2. Wait for required CI checks (`gh pr checks <n> --watch`).
3. Merge and delete the branch (`gh pr merge <n> --merge --delete-branch`).

## Approval

Wait for explicit approval to **commit** and, separately, to **merge**. A broad "do what you
think is right" is not either one. Between them, **push and open the PR freely** — that is
where the owner reads the diff ([../commands/git/commit-local-changes.md](../commands/git/commit-local-changes.md)).

The two gates exist for different reasons: a commit is what the owner reviews, and merging
`dev` **auto-deploys to production** — so merge approval is never implied by commit approval.
Report the CI result, then ask. Force-pushing your own unmerged branch is fine (that is how a
mistake stays out of `dev`'s history); force-pushing `dev` or `main` is not.
