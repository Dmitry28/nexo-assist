# Workflow Loop

One loop for all tasks. Plan depth scales with complexity — a simple fix needs 2–3 lines; a multi-step feature needs full breakdown.

## 1. Plan

- Gather context: read existing code, docs, related files — verify theory before making claims.
- Describe the solution; for complex tasks add non-goals, milestones, acceptance criteria.
- **Self-validate**: are all edge cases covered? are all claims grounded in actual code/docs?
- For complex tasks, document key architectural decisions: what was chosen vs. rejected and why (prevents re-deliberation).
- Get user confirmation before implementing anything non-trivial.

## 2. Implement

- One milestone at a time. Keep changes focused and atomic.
- Implement → verify → report, **leaving all changes uncommitted**.
- **Never commit, push, or open a PR without explicit approval of the reviewed diff.** Approval means the user has seen these specific local changes and said to commit them. A broad task mandate ("do whatever you think is right") authorizes implementing — not committing.
- After opening a PR, surface the URL so the user can review.
- Reflect on what was learned — if new findings affect the solution, address them before moving on.
- If you hit ambiguity or a blocking decision mid-task — **surface it immediately instead of guessing.**

## Git Workflow

- Branch off `main`, PR to `main`.
- Conventional Commits (see `docs/llm/commands/git/rules/changes-message-format-rules.md`).
- Pre-commit hook (husky + lint-staged) runs ESLint + Prettier on staged TS files.
- CI must be green before merge.
- Default merge: `gh pr merge --squash --delete-branch`.

## 3. Verify

- Confirm the plan step is fully realized (nothing skipped).
- Run `/verify-task-result` on changed files.
- Quick self-check: architecture, types, naming.
- **Generation is fast; verification is the bottleneck — don't skip or rush this step.**

## 4. Fix

- Address failures immediately — don't defer issues to later milestones.
- Minor non-critical improvements can be left as `// TODO:` comments to address later.
- If the same approach fails 2+ times — **stop, reflect on why, ask the user instead of retrying.**

_(Repeat steps 2–4 for each milestone)_

---

**After all work is complete — run every step in order, do not skip:**

1. Run `/verify-task-result` with full checks.
2. Run `/review-code` over all branch changes.
3. Fix any issues found in 1–2.
4. Cover critical logic with tests if not yet covered — only what matters.
5. Update docs if architecture/patterns/logic changed.
6. **Propose a TODO for any real issue you notice but don't fix in current scope** — pre-existing inconsistencies, dead code, optimization opportunities, edge cases. Verify it's real (read the code); don't TODO speculative concerns. Format: see [comment rules](code-style.md#comments).
7. **Reflection** — review LLM instructions (`docs/llm/`): did any instruction mislead, miss a needed pattern, or fail to prevent a mistake you made? If yes — update it directly. Skip if nothing genuinely new.
8. **Stop with everything uncommitted.** Summarize the changes and wait for the user to review the local diff — committing is a separate, explicitly approved step (see Implement).

---

## Scaling Guide

| Task size          | Plan                       | Milestones                 | Progress tracking         |
| ------------------ | -------------------------- | -------------------------- | ------------------------- |
| Simple (1 step)    | 2–3 lines                  | —                          | —                         |
| Medium (2–3 steps) | Solution + non-goals       | 2–3 explicit               | —                         |
| Complex (3+ steps) | Full breakdown + decisions | Each with scope boundaries | Externalized progress log |

### Externalized Progress (complex tasks)

For long tasks, maintain a progress section in the plan (or a scratch file) that survives context compression:

- Completed milestones (one-liner each)
- Current milestone and remaining work
- Key decisions made (one-liner each)
- Known issues to address later

Update after each milestone. Acts as durable memory the agent can re-read to stay oriented.
