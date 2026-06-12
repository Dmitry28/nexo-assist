# Logic Review Rules

**Scope:** feature / application behavior — does the change do what the task asks? For code conventions, see [code-review.md](code-review.md).

## Comment Labels

Same H/M/L/D/Q + SA convention as [code-review.md § Comment Labels](code-review.md#comment-labels-ccr).

## How to Review

1. Get the list of changed files and the task source: linked GitHub issue, PR description, or the plan agreed in conversation.
2. Extract the **acceptance criteria** (AC) from the task source as an explicit list. No written AC → reconstruct them from the agreed plan and confirm the list before reviewing.
3. For each AC — grep / read the diff to locate its implementation. Record `file:line`. Missing → `[H]`; ambiguous → `[M]`.
4. Walk the **Logic Checklist** below against the diff and the task.
5. Record only findings grounded in an AC or a checklist item. Drop speculative concerns; verify in code first.

**Cite only sources you actually loaded** — doc paths, task text, or `file:line` from the diff. No memory citations.

## Logic Checklist

### Task alignment

- Every acceptance criterion is met — letter **and** intent.
- No out-of-scope changes; if any, justified in the PR description.
- Behavior matches what a real caller does, not just the happy path.

### Edge cases

- `null` / `undefined` / empty inputs handled (validation DTOs cover the boundary).
- Error paths return the standard error shape (global filter), not leaked internals.
- Race conditions: concurrent requests, double-submits, out-of-order responses.
- Boundary values: `0`, `1`, max, off-by-one (pagination limits, throttle windows).

### Security & data

- Input validated at system boundaries (DTOs with `class-validator`; whitelist on).
- No sensitive data in logs, URLs, error messages.
- Authorization checks present where required.

### Performance

- No N+1 queries; batch where possible.
- No blocking sync work on hot paths.
- No unbounded result sets — paginate.

## Output Format

Start with a one-line coverage receipt, then the AC traceability matrix, then findings grouped by file (H → M → L → D → Q).

AC matrix legend: `[x]` met (concrete `file:line`) · `[~]` ambiguous → `[M]` finding · `[ ]` not implemented → `[H]` finding.

```
## Logic Review

Reviewed: AC M/N met | edge cases scanned

### AC traceability
- [x] AC 1: <text> — `src/path.ts:42`
- [~] AC 2: <text> — `src/path.ts:18` (implementation ambiguous)
- [ ] AC 3: <text> — not implemented

### `path/to/file.ts`
- [H] Description (cite task § AC)
  SA: Concrete fix

## Improvement plan
1. **Fix first** — `[H]` findings (missing AC, broken behavior, security)
2. **Address** — `[M]` findings (ambiguous AC, edge cases, performance)
3. **Polish** — `[L]` findings (minor)
```

If all AC met and no issues — emit the receipt followed by `✅ All AC met, no issues found` (omit Improvement plan).

## Reflection

See [code-review.md § Reflection](code-review.md#reflection).
