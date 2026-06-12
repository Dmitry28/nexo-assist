# Code Review Rules

**Scope:** the code + PR artifacts. For feature behavior vs the task, see [logic-review.md](logic-review.md).

## Comment Labels (CCR)

| Label | Severity                                | SA required |
| ----- | --------------------------------------- | ----------- |
| `[H]` | Critical — must be fixed before merging | Yes         |
| `[M]` | Major                                   | Yes         |
| `[L]` | Minor                                   | Yes         |
| `[D]` | Discuss — surface for a call            | No          |
| `[Q]` | Question — informational                | No          |

**SA** (Suggested Action) — a concrete fix suggestion, required for `[H]`, `[M]`, `[L]`.

## How to Review

1. Get the list of changed files (`git diff --name-only` or PR diff).
2. For each row in the **Triggers** table — if a changed file matches, load the listed DOC(s) in full and check every rule against every matching file. **Do not load DOCs whose triggers did not match.**
3. Apply every row of the **Process Checks** table to its artifact.
4. Apply **Pattern Check** (below) to every candidate finding.
5. Record only findings grounded in a loaded DOC rule, a Process Check, or a Pattern Check deviation with a cited `file:line`.

## Pattern Check

**Always flag, skipping Pattern Check:** correctness bugs, security issues (secrets, unvalidated input, injection), violations of a loaded DOC rule.

For other candidate findings — grep the codebase for how peers handle the same choice (error handling, DTO shape, config access, naming, file/folder shape, async style):

- Changed code matches the dominant pattern (≥3 occurrences across ≥2 files) → **drop**.
- Suggestion has 0 codebase precedent → **drop**.
- ≥2 patterns each with ≥3 occurrences → **drop "unify" suggestions**.
- Near-zero-precedent variant while a dominant alternative exists → **flag**, cite one `file:line` of canonical usage in the SA.

Escape hatches: 0 peers anywhere → suspend Pattern Check (rely on DOCs); changed code follows a documented migration direction → don't flag against the legacy pattern.

## Pre-Output Verification

Before emitting any `[M]` / `[L]` candidate, do a second-pass Pattern Check — first-pass grep can miss peer usages; this pass filters false positives so they never reach the user.

1. Re-read the cited rule and SA.
2. Grep how peers handle the same case (≥2 files, ≥3 occurrences = dominant pattern).
3. Changed code already matches the dominant pattern → mark **SKIPPED — pattern already followed**, move to § Skipped; do NOT include in main findings.
4. Otherwise emit as a normal finding.

`[H]` correctness/security findings skip this pass — emit immediately.

## Triggers

| Trigger (changed paths / file types)                  | DOC to read                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Any change under `src/**`                             | `docs/llm/rules/architecture.md`, `docs/llm/rules/development-philosophy.md` |
| `*.ts`                                                | `docs/llm/rules/code-style.md`, `docs/llm/rules/typescript.md`               |
| `*.spec.ts`, `*.e2e-spec.ts`, `test/**`               | `docs/llm/rules/testing.md`                                                  |
| `docs/llm/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md` | `docs/llm/rules/llm-skills-guide.md`                                         |

## Process Checks

| Topic           | Mode   | Rule                                                                                                                                           |
| --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-Check      | Both   | [development-philosophy.md § Self-Check](development-philosophy.md#self-check)                                                                 |
| Commit messages | Both   | `docs/llm/commands/git/rules/changes-message-format-rules.md` § 1                                                                              |
| PR title + body | Remote | `docs/llm/commands/git/rules/changes-message-format-rules.md` § 2                                                                              |
| DOC updates     | Both   | [workflow.md](workflow.md) post-completion step 6 — docs updated when architecture/patterns changed                                            |
| Tests           | Both   | New endpoints/services covered per `docs/llm/rules/testing.md`                                                                                 |
| CI              | Remote | `gh pr checks` green. Failing job caused by this PR → `[H]`. Also failing on `main` → `[Q]` "pre-existing". Still running → note, don't block. |

## Output Format

Start with a one-line coverage receipt, then findings grouped by file. Skip files with no issues. Within a file, order findings **H → M → L → D → Q**.

```
## Review

Reviewed: N/N files | findings: <H>H + <M>M + <L>L | DOCs: code-style.md, … | mode: <local|remote>

### `path/to/file.ts`
- [H] Description of the issue
  SA: Concrete fix

- [L] Minor style issue
  SA: How to fix (cite `file:line` of canonical usage for Pattern Check findings)

## Improvement plan
1. **Fix first** — `[H]` findings (bugs, security)
2. **Refactor** — `[M]` findings (pattern violations, architecture)
3. **Polish** — `[L]` findings (style, minor)

## Skipped (pattern already followed)
- `path/to/file.ts` — what was checked, dominant pattern cited as `file:line`
```

If no issues — emit the receipt followed by `✅ No issues found` (omit Improvement plan). Omit § Skipped when empty.

Under-coverage (`N < total`) → `[H]` finding listing the missing files, not a silent drop.

## Reflection

Propose updates to shared instructions (`docs/llm/`, `.claude/skills/`) only when grounded in a real review finding — specific, minimal. Skip if nothing came up.

**DOC vs code:** when multiple files violate the same rule the same way, consider whether the DOC is stale (and update it) instead of fixing each file — massive same-shape violations signal the convention has shifted.
