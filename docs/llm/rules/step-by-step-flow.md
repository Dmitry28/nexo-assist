# Step-by-step flow

The per-step loop when the user asks to work "step by step" (e.g. a phase). One step at a time;
the full-task loop is in [workflow.md](workflow.md).

1. **Describe** the step plainly — what & why, not diff-level how → wait for approval. Never implement before approval.
2. **Implement** the approved step — focused and atomic.
3. **Verify** — `/verify-task-result` (lint / typecheck / tests); for behavioral changes exercise the path.
4. **Review** — `/logic-review` and `/review-code` (launched together) on this step's changes. Fix `[H]` only; log the rest (ENTRY_POINT § Core Rules) — chasing `[M]`/`[L]` here is what turns one step into five review rounds. Re-review only if a fix changed behavior.
5. **Show the diff** + a plain-language summary (what changed & why, understandable to a non-implementer) → wait for the user's review + approval.
6. **Commit** via `/git-commit` — one focused commit. Then next step.

**Review fixes are steps too.** After fixing a finding, show the fix diff and wait for approval
before committing — no earlier approval ("push/PR ok" included) carries to a new commit.

Track steps in a lean scratch file (table + current step) so progress survives context
compression. One PR per phase bundles the step-commits ([github.md](github.md)).

**Before opening the phase PR**, run a full `/logic-review` and `/review-code` (launched together) over the whole
accumulated diff (`dev..HEAD`), not just the last step — it catches cross-step integration
issues the per-step reviews miss. Fix findings, then open the PR.
