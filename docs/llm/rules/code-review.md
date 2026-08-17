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
5. Record only findings grounded in a loaded DOC rule, a Process Check, a Pattern Check deviation with a cited `file:line`, **or § Whole-Change Pass**.
6. Run **§ Whole-Change Pass**.

## Pattern Check

**Always flag, skipping Pattern Check:** correctness bugs, security issues (secrets, unvalidated input, injection), violations of a loaded DOC rule.

For other candidate findings — grep the codebase for how peers handle the same choice (error handling, DTO shape, config access, naming, file/folder shape, async style):

- Changed code matches the dominant pattern (≥3 occurrences across ≥2 files) → **drop**.
- Suggestion has 0 codebase precedent → **drop**.
- ≥2 patterns each with ≥3 occurrences → **drop "unify" suggestions**.
- Near-zero-precedent variant while a dominant alternative exists → **flag**, cite one `file:line` of canonical usage in the SA.

Escape hatches: 0 peers anywhere → suspend Pattern Check (rely on DOCs); changed code follows a documented migration direction → don't flag against the legacy pattern.

## Whole-Change Pass

Pattern Check keeps the review honest, but it structurally silences one thing: _"this could be
simpler than anything we do today."_ So run one pass, **exempt from Pattern Check**, asking a
different question — **is this the best version of itself?** Precedent is not required; instead of
citing a peer, state what it costs to leave as is.

- Judge the change **as a whole**, not hunk by hunk, and read the **final state**, not the diff.
- Ask what can be **deleted**: a payload copied to a second call site, a test that is a weaker
  copy of its neighbour, a rule re-explained where it's used instead of linked, prose an LLM
  already knows (**LLM instructions only** — see § Human-Facing Docs for why product docs are
  the opposite).
- Label these `[D]` — they are proposals, not rule violations. An outright defect found here is
  just an `[H]`/`[M]`, as anywhere else.

**Re-run this pass after findings are applied** ([workflow.md § Post-completion checklist](workflow.md#post-completion-checklist), step 6): fixing one
thing is where the next defect usually appears, and this pass is the only one that sees it.

## Human-Facing Docs

For `*.md` outside `docs/llm/` — product docs and the root `README`. § Self-Check already applies
(Process Checks, both modes); these add what only docs can get wrong:

- **True right now.** Every claim checkable against the code, and checked. A doc that promises
  behavior the code doesn't have is worse than no doc — it is trusted.
- The claim's scope matches the code's: no "always" where the code has an exception.

**Do not apply "non-obvious only" here** — that rule is for LLM instructions. These docs explain
concepts to a person on purpose ([DEPLOY.md](../../DEPLOY.md) is a learning guide), so removing an
explanation because a model already knows it destroys their point.

## Pre-Output Verification

Before emitting any `[M]` / `[L]` **that came from a DOC rule or Pattern Check**, re-run Pattern
Check once more (first-pass grep misses peers). If the changed code matches the dominant pattern,
route it to § Skipped ("pattern already followed") instead of the findings.

Two carve-outs, emitted immediately: `[H]` correctness/security, and anything from
§ Whole-Change Pass — it argues _against_ the dominant pattern by design, so this gate would
silence exactly what it exists to surface.

## Triggers

| Trigger (changed paths / file types)                  | DOC to read                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Any change under `src/**`                             | `docs/llm/rules/architecture.md`, `docs/llm/rules/development-philosophy.md` |
| `*.ts`                                                | `docs/llm/rules/code-style.md`, `docs/llm/rules/typescript.md`               |
| `*.spec.ts`, `*.e2e-spec.ts`, `test/**`               | `docs/llm/rules/testing.md`                                                  |
| `docs/llm/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md` | `docs/llm/rules/llm-skills-guide.md`                                         |
| Other `*.md` (product docs, root `README`)            | § Human-Facing Docs (above)                                                  |

## Process Checks

| Topic           | Mode   | Rule                                                                                                                                           |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-Check      | Both   | [development-philosophy.md § Self-Check](development-philosophy.md#self-check)                                                                 |
| Commit messages | Both   | `docs/llm/commands/git/rules/changes-message-format-rules.md` § 1                                                                              |
| PR title + body | Remote | `docs/llm/commands/git/rules/changes-message-format-rules.md` § 2                                                                              |
| DOC updates     | Both   | Every doc the change affects updated in the same change (ENTRY_POINT § Keep docs current)                                                      |
| Tests           | Both   | New endpoints/services covered per `docs/llm/rules/testing.md`                                                                                 |
| CI              | Remote | `gh pr checks` green. Failing job caused by this PR → `[H]`. Also failing on `main` → `[Q]` "pre-existing". Still running → note, don't block. |

## Output Format

Start with a one-line coverage receipt, then findings grouped by file. Skip files with no issues. Within a file, order findings **H → M → L → D → Q**.

```
## Review

Reviewed: N/N files | findings: <H>H + <M>M + <L>L + <D>D | DOCs: code-style.md, … | mode: <local|remote>

### `path/to/file.ts`
- [H] Description of the issue
  SA: Concrete fix

- [L] Minor style issue
  SA: How to fix (cite `file:line` of canonical usage for Pattern Check findings)

## Improvement plan
1. **Fix first** — `[H]` findings (bugs, security)
2. **Refactor** — `[M]` findings (pattern violations, architecture)
3. **Polish** — `[L]` findings (style, minor)
4. **Discuss** — `[D]` proposals (§ Whole-Change Pass, stale instructions): accept or reject each explicitly

## Skipped (pattern already followed)
- `path/to/file.ts` — what was checked, dominant pattern cited as `file:line`
```

If no issues — emit the receipt followed by `✅ No issues found` (omit Improvement plan). Omit § Skipped when empty.

Under-coverage (`N < total`) → `[H]` finding listing the missing files, not a silent drop.

## Reflection

This review reports; it never edits. When a finding shows an instruction is stale or misleading,
emit a `[D]` naming the file and section, so the Reflection step in
[workflow.md](workflow.md#post-completion-checklist) can apply it as a normal reviewed change.

**DOC vs code:** when multiple files violate the same rule the same way, say so — a same-shape
violation across files usually means the convention shifted and the DOC is stale, so fixing the
DOC beats fixing each file.
