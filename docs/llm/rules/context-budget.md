# Context Budget

A tool call is paid for by re-sending the whole context, not by the size of its output — though
that output joins the context and is re-sent from then on. What costs is **how many round-trips**
a task takes and **how big the context is** when they happen. (Measured on ops-fe / io-proxy
sessions, August 2026: re-sent context was 82% of spend, generation 7%.)

## Don't cut quality to save context

Investigation depth, verification, the two reviews, the
[post-completion checklist](workflow.md#post-completion-checklist), the written plan — none of
these is where the cost sits. Guessing to avoid a read costs more than the read.

## Fewer round-trips

One call should answer one question completely.

- **Batch independent calls into one message** — parallel `Read`s, a grep and the file it points at.
- **Fold a shell sequence into one command** (`&&` / `;` with `echo` separators) instead of
  probe → read → act as three calls.
- `Read` a file you are about to edit (it tracks file state for `Edit`); take a narrow `sed -n`
  slice for a few known lines.
- Keep a big payload out of the context it then sits in: scope `git diff` to paths, `--stat` first
  when only the shape matters, pipe JSON through `jq`.
- Skip any call whose result you can predict: re-reading what is already in context, a verification
  read after a successful `Edit`, re-running a command whose output cannot have changed.

## One session, one phase

Cost per call grows with context size — measured at ~20k below 200k of context and ~91k above
700k, i.e. 4.5× for identical work.

- Research + plan, implementation, and review each get their own session. Implementation starts
  from the plan file, and that file stays current: the next session reads it, not the transcript.
- **Checkpoint at ~250k** — write state to the plan or scratch file **first**, then reset the
  context (fresh session at the next milestone, or `/compact` mid-step). A summary is not durable
  state; the file is.

## Delegate the sweeps

A subagent reads in its own context and returns only the answer.

- "Where is X defined", "what calls Y", "map this directory" → `compressed-locator`
  (`.claude/agents/`), which answers in compact `path:line — symbol` rows.
- Sweeps that need reasoning over the code, not just locations → `Explore` or `general-purpose`.
- A file you already know you need — read it directly; a subagent for one known file is pure
  overhead.
