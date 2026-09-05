# Workflow Loop

One loop for all tasks. Plan depth scales with complexity — a simple fix needs 2–3 lines; a multi-step feature needs full breakdown.

## 1. Plan

- Gather context: read existing code, docs, related files — verify theory before making claims. Broad sweeps ("where is X", "what calls Y", "how does Z work across modules") go to a subagent ([context-budget.md § Delegate the sweeps](context-budget.md#delegate-the-sweeps)).
- Describe the solution; for complex tasks add non-goals, milestones, acceptance criteria.
- **Self-validate**: are all edge cases covered? are all claims grounded in actual code/docs?
- For complex tasks, document key architectural decisions: what was chosen vs. rejected and why (prevents re-deliberation).
- For medium/complex tasks a written plan is mandatory before code. "Too simple to need a plan" → scale the plan down, don't skip it.
- Get user confirmation before implementing anything non-trivial.

## 2. Implement

- One milestone at a time: describe the plan → wait for approval → implement → show the diff → wait for approval → next. Keep changes focused and atomic.
- When the user asks to work **step by step**, follow [step-by-step-flow.md](step-by-step-flow.md) — it adds a per-step review before each commit.
- **Show a milestone for review only when it is finished** — implemented _and_ verified (§ 3). A half-done diff costs a review pass that has to be repeated.
- **No new tests while implementing** — run the existing suite to catch regressions; new tests come once, at [post-completion step 1](#post-completion-checklist). A test written against one milestone gets rewritten by the next and bloats every diff the user reviews on the way.
- Implement → verify → report, **leaving all changes uncommitted**; the two approval gates are in
  [github.md § Approval](github.md#approval).
- After opening a PR, surface the URL so the user can review.
- Reflect on what was learned — if new findings affect the solution, address them before moving on.
- If you hit ambiguity or a blocking decision mid-task — **surface it immediately instead of guessing.**

## Git Workflow

- Branch flow, language, and PR lifecycle → [github.md](github.md).
- Pre-commit hook (husky + lint-staged) runs ESLint + Prettier on staged TS files.

## 3. Verify

- Confirm the plan step is fully realized (nothing skipped).
- Run `/verify-task-result` on changed files.
- For behavioral changes, run the app and exercise the path (`/run`) — not only unit tests.
- Self-check: [philosophy questions](development-philosophy.md#self-check) (simple / clear / concise / DRY / no excess) + architecture, types, naming, edge cases.

## 4. Fix

- Address failures immediately — don't defer issues to later milestones.
- Improvements that surface mid-loop: **fix it or log it** (ENTRY_POINT § Core Rules) — don't let them derail the current milestone.
- If the same approach fails 2+ times — **stop, reflect on why, ask the user instead of retrying.**

_(Repeat steps 2–4 for each milestone)_

---

## Post-completion checklist

**Run every step in order, do not skip.** "This change is too small" → scale the check down, don't skip it.

**A change that makes no decision** — a typo, a constant, a doc sentence, a config value — skips steps 1 and 4–6: the reviews and the test pass exist to catch decisions it didn't make. Anything that adds behaviour, a dependency, a query or a state change takes the full list.

1. Cover critical logic with tests if not yet covered — only what matters.
2. Update every doc the change affects (ENTRY_POINT § Keep docs current).
3. Run `/verify-task-result` with full checks.
4. Run `/logic-review` (behavior vs the task) **and** `/review-code` (rules, patterns, whether it's the best version) — **launch both at once**: they are independent and read-only, so sequencing them only costs wall-clock. Steps 1–2 come first so the tests and docs are inside what gets reviewed.
5. Read both before acting: a finding can be wrong, and the two can contradict each other. Verify each against the code and say out loud which you reject and why.
6. Fix what survives — **`[H]` only** (ENTRY_POINT § Core Rules); everything else gets a `TODO` or a backlog entry. A finding is reported once but usually lives in more than one place — check for siblings before calling it fixed. Touched behavior or fixed an `[H]`? Re-run the review — applying a fix is where the next defect appears.
7. Sweep the issues you noticed along the way — pre-existing inconsistencies, dead code, edge cases — and apply **fix it or log it** (ENTRY_POINT § Core Rules).
8. **Reflection** — improve **repo-tracked** instructions (`docs/llm/`, `.claude/skills/`) so the next contributor avoids the same friction. **Not personal memory — only files committed to the repo.** Edit when an instruction misled you, was easy to skip, or missed a pattern you used. Each edit: specific (cite file/section), minimal (one focused change). **Prefer mechanical enforcement to prose** — where a rule can be an ESLint rule, a hook or a test, add that instead of another sentence nobody re-reads. Skip if nothing came up — don't invent improvements to fill the slot.

   **A correction the user makes mid-task lands in its instruction doc right away** — not here, and not in the plan file.

9. Changed anything in steps 6–8? Re-run `/review-code` over the final diff — otherwise the last edits ship as the only unreviewed part of the change.
10. **Read the checklist back** — one line per step, done or skipped and why. A step nobody can name is a step that was skipped.
11. **Stop with everything uncommitted.** Summarize the changes and wait for the user to review the local diff — committing is a separate, explicitly approved step (see Implement).

---

## Scaling Guide

| Task size          | Plan                       | Milestones                 |
| ------------------ | -------------------------- | -------------------------- |
| Simple (1 step)    | 2–3 lines                  | —                          |
| Medium (2–3 steps) | Solution + non-goals       | 2–3 explicit               |
| Complex (3+ steps) | Full breakdown + decisions | Each with scope boundaries |

Complex tasks also keep a progress log in the plan or a scratch file — done / current / key
decisions / known issues, updated after each milestone — so progress survives context compression
and a fresh session ([context-budget.md § One session, one phase](context-budget.md#one-session-one-phase)).
