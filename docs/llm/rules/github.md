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
- **Two branches, two roles:** `dev` is where everything integrates and is tested locally before
  a release; `main` is production — a push to it deploys. Nothing reaches `main` except a merge
  of `dev`.
- **Cut every branch from `dev`, never from another still-open branch** — otherwise this PR carries
  the other one's commits and its review. A step that genuinely cannot work without the previous
  one belongs in the same PR.
- PRs target `dev`. Promote `dev → main` only after the change was **run and tested locally** —
  that merge is the release, and it deploys to production.
- One PR may bundle several steps — keep them as separate, focused commits.
- **`* [new branch]` when pushing a branch you already pushed means the remote one is gone** —
  usually its PR merged and `--delete-branch` removed it, and the push re-creates it with commits
  already on `dev`. Check the PR state (`gh pr view <n> --json state`) before doing anything;
  if it did merge, re-cut from `origin/dev` and carry over only what is genuinely new.

## Commits & PR Text

- Message format → [../commands/git/rules/changes-message-format-rules.md](../commands/git/rules/changes-message-format-rules.md).
- Generate a commit with `/git-commit`, a PR description with `/pr-description`.
- Correcting a PR or issue comment → **edit the existing one**, never post a second.
- Stage every file of the change, then check the commit with `git show --stat HEAD` — why:
  [commit-local-changes.md § After committing](../commands/git/commit-local-changes.md#after-committing).

## Calling the API

- Pass a multi-line body as a **file** (`gh pr create --body-file <path>`, `curl -d @<path>`) —
  never a heredoc or `-d "$(…)"`. Command substitution swallows the builder's failure: the request
  still fires, with an empty or mangled body.
- **An empty answer is not evidence of empty data** — a failed call behind `| jq` prints nothing, a
  wrong path yields `[]`, an ignored filter parameter returns everything, and a listing can omit a
  field the dedicated endpoint has. Check the raw body once before believing it, and never turn a
  failed call into a negative result: retry, then report what could not be fetched.

## PR Lifecycle

1. **Full pre-PR review** over the whole branch (`dev..HEAD`), not the last step only —
   [workflow.md § Post-completion checklist](workflow.md#post-completion-checklist) step 4, with
   `/logic-review` given the task and plan. Fix findings, then push **once** and open the PR
   against `dev` (`gh pr create --base dev`).
2. Wait for required CI checks (`gh pr checks <n> --watch`). Then re-read the PR title and body
   against the final diff ([format rules](../commands/git/rules/changes-message-format-rules.md)
   § 2), and treat every PR comment and review as a review finding
   ([workflow.md § Post-completion checklist](workflow.md#post-completion-checklist) steps 5–6):
   fix `[H]`, log the rest, reply with the verdict.
3. **Give the owner the PR link and wait for the merge approval** (§ Approval) — owner's rule,
   2026-10-06: the link comes before every merge, even under a standing "merge after review".
   Then merge and delete the branch (`gh pr merge <n> --merge --delete-branch`).
4. **Release** (separate approval): test the change locally against `dev`, then promote —
   `gh pr create --base main --head dev` → merge. That push to `main` is what deploys.

## Approval

Wait for explicit approval to **commit** and, separately, to **merge**. A broad "do what you
think is right" is not either one. Once the owner approves a diff, you commit it yourself
(`/git-commit`). Between the two gates, opening the PR needs no approval.

**Push once, at the end.** Owner's instruction, 2026-09-09, repeated 2026-10-06: commit locally
as you go and push a single time, right before opening the PR — not after each commit. Fixes after
the PR is open are committed together and pushed once too.
It keeps the PR from being read while it is still growing, and it avoids the failure noted above:
five same-day PRs pushed one at a time raced with their own merges twice, each time re-creating a
deleted branch that then had to be rebased and cleaned up.

The two gates exist for different reasons: a commit is what the owner reviews, and merging
into `main` **auto-deploys to production** — so merge approval is never implied by commit
approval. Merging a feature branch into `dev` deploys nothing, but still needs its own approval;
the `dev → main` promotion needs a separate one again, after local testing.
Report the CI result, then ask. `git push --force-with-lease` on your own unmerged branch is fine
(that is how a mistake stays out of `dev`'s history; plain `--force` is denied in settings);
force-pushing `dev` or `main` is not.

NOTE: `.claude/settings.json` prompts only on `git push` and `gh pr merge` — `git commit` is
allowed without a prompt on purpose (the prompts were noise). Commit approval is therefore a
rule you follow, not a gate the harness enforces: still show the diff and wait.
