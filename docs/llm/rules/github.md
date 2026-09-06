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
- **Cut every branch from `dev`, never from another still-open branch** — otherwise this PR carries
  the other one's commits and its review. A step that genuinely cannot work without the previous
  one belongs in the same PR.
- PRs target `dev`. Promote `dev → main` only after testing on `dev`.
- One PR may bundle several steps — keep them as separate, focused commits.
- **`* [new branch]` when pushing a branch you already pushed means the remote one is gone** —
  usually its PR merged and `--delete-branch` removed it, and the push re-creates it with commits
  already on `dev`. Check the PR state (`gh pr view <n> --json state`) before doing anything;
  if it did merge, re-cut from `origin/dev` and carry over only what is genuinely new.

## Commits & PR Text

- Message format → [../commands/git/rules/changes-message-format-rules.md](../commands/git/rules/changes-message-format-rules.md).
- Generate a commit with `/git-commit`, a PR description with `/pr-description`.
- Correcting a PR or issue comment → **edit the existing one**, never post a second.

## Calling the API

- Pass a multi-line body as a **file** (`gh pr create --body-file <path>`, `curl -d @<path>`) —
  never a heredoc or `-d "$(…)"`. Command substitution swallows the builder's failure: the request
  still fires, with an empty or mangled body.
- **An empty answer is not evidence of empty data** — a failed call behind `| jq` prints nothing, a
  wrong path yields `[]`, an ignored filter parameter returns everything, and a listing can omit a
  field the dedicated endpoint has. Check the raw body once before believing it, and never turn a
  failed call into a negative result: retry, then report what could not be fetched.

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
