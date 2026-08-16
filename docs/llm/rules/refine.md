# Refine — final pass before a PR

Mandatory before opening a PR ([workflow.md](workflow.md) post-completion checklist), and on
request. Two passes, run separately — they ask different questions.

**Fresh eyes are the method.** Judge the final state as if someone else wrote it; don't re-read
the diff you remember writing.

## Pass A — the result

Is this the right solution, and the simplest one that does the job?

- [Self-check](development-philosophy.md#self-check) over the change **as a whole**, not per hunk.
- Nothing missed, nothing broken: side effects, edge cases, and the parts of the task that are
  easy to leave half-done.
- [workflow.md](workflow.md) executed end to end; every applicable rule in this directory honored.

## Pass B — the `.md` instructions

Different question: **what can be deleted?** Judge every `.md` the change touched against
[llm-skills-guide.md § Content Quality](llm-skills-guide.md#content-quality). The sharpest cuts:
prose an LLM already knows, and a rule explained a second time where it's used instead of linked.

## Output

Per pass: "clean", or a concrete list of edits — then **apply them**. Reporting without fixing
doesn't count as a pass.
