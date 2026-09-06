# Systematic Debugging

## Iron Law

No fixes without root cause investigation first. Trace the bad value **back to where it
originates**, not to where the error surfaces.

## Loop

1. **Investigate** — reproduce consistently; read the whole error; check `git diff` / `git log`,
   new dependencies, env differences.
2. **Compare** — find a working peer in this codebase and list every difference, however small.
3. **Hypothesize** — one at a time ("X is the root cause because Y"), tested with the smallest
   possible change. Didn't work → new hypothesis, back to step 1.
4. **Fix** — a failing test first where feasible, then the root cause; verify no regressions.

**Stop rules.** 3+ failed attempts → stop and reassess the architecture instead of trying more
variants. A bug crossing component boundaries (HTTP → service → DB) → log at each boundary, run
once to see **where** it breaks, and only then debug that component.

**Red flags — stop and restart from step 1:** "quick fix now, investigate later"; "just try X and
see"; "it's probably X" without evidence; several changes at once; each fix revealing a new problem.

## Capture

After the fix is verified, ask whether the bug is a recurring **class** worth pinning as a rule.
Skip the step if not — don't invent rules to fill the slot.

- Common classes: race / null-guard / off-by-one / wrong-default / wrong-coercion (`||` vs `??`) /
  missing-guard / silent-throw / stale-closure / unmocked-boundary.
- **Class match** → add or extend a rule in `docs/llm/rules/` + a test that pins it. Repo-tracked
  `.md` only — never personal memory.
- **No class** (typo, one-time migration, external-dep bump) → record only in the commit/PR text.
