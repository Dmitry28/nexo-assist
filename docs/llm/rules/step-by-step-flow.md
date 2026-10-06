# Step-by-step flow

The per-step loop when the user asks to work "step by step" (e.g. a phase). One step at a time;
the full-task loop is in [workflow.md](workflow.md).

1. **Describe** the step → wait for approval. Never implement before approval. **3–5 lines:** why, what, what it costs. Internals, measurements, the how and review notes stay out unless asked.
2. **Implement** the approved step — focused and atomic.
3. **Verify** — `/verify-task-result` (lint / typecheck / tests); for behavioral changes exercise the path.
4. **Review** — `/logic-review` and `/review-code` (launched together) on this step's changes. Fix `[H]` only; log the rest (ENTRY_POINT § Core Rules) — chasing `[M]`/`[L]` here is what turns one step into five review rounds. Re-review only if a fix changed behavior.
5. **Show the diff** + a summary in **3–5 short lines**: what changed, why, how verified — plain words, no internals → wait for approval.
6. **Commit** via `/git-commit` — one focused commit, not pushed. Then next step.

**Review fixes are steps too.** After fixing a finding, show the fix diff and wait for approval
before committing — no earlier approval ("push/PR ok" included) carries to a new commit. Approving
a _list_ of findings approves no fix in it: each one is proposed with its verdict and its diff.

Track steps in a lean scratch file (table + current step) so progress survives context
compression. One PR per phase bundles the step-commits ([github.md](github.md)).

**Before opening the phase PR**: the full pre-PR review ([github.md § PR Lifecycle](github.md#pr-lifecycle)
step 1) over the whole branch, not just the last step — it catches cross-step integration issues
the per-step reviews miss.
