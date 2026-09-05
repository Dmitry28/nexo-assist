# Systematic Debugging

## Iron Law

No fixes without root cause investigation first.

## Five Phases (sequential, do not skip)

### Phase 1: Investigate

- Read error messages fully (stack trace, line numbers, error codes).
- Reproduce consistently (exact steps, every time).
- Check recent changes: `git diff`, `git log`, new dependencies, env differences.
- Trace data flow backward to the source of the bad value — don't fix where the error appears (symptom); find where it originates.

### Phase 2: Analyze

- Find working examples of similar code in the codebase.
- Compare working vs broken — list every difference, however small.
- Identify dependencies and assumptions (config, env, state, timing).

### Phase 3: Hypothesize & Test

- Form a single hypothesis: "I think X is the root cause because Y".
- Test with the smallest possible change, one variable at a time.
- Worked? → Phase 4. Didn't work? → new hypothesis, back to Phase 1.

### Phase 4: Fix

- Write a failing test if feasible.
- Implement a single fix addressing the root cause (not the symptom).
- Verify: fix works + no regressions.
- If 3+ failed attempts → stop, reassess architecture (likely not a fix problem).

### Phase 5: Capture

After the fix is verified, ask whether the bug is a recurring **class** worth pinning as a rule. Skip the step if not — don't invent rules to fill the slot.

- Restate root cause in one line.
- Match against common classes: race / null-guard / off-by-one / wrong-default / wrong-coercion (`||` vs `??`) / missing-guard / silent-throw / stale-closure / unmocked-boundary.
- **Class match** → add or extend a rule in the right place (`docs/llm/rules/`) + a test that pins the rule. Repo-tracked `.md` only — never personal memory.
- **No class** (typo, one-time migration, external-dep bump) → skip; record only in the commit/PR description.

## Red Flags (stop and restart from Phase 1)

- "Quick fix for now, investigate later".
- "Just try changing X and see if it works".
- "It's probably X, let me fix that" (without evidence).
- Multiple changes at once without understanding each.
- Each fix reveals a new problem elsewhere.
- "I don't fully understand but this might work".

## Multi-component Systems

When a bug crosses component boundaries (HTTP → service → DB, etc.):

1. Log data at each boundary (entering, exiting).
2. Run once to gather evidence showing WHERE it breaks.
3. Identify the failing component.
4. Investigate that specific component using Phases 1–4.
