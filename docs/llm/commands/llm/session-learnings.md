# Session Learnings

Scan this project's Claude Code session logs, find recurring owner feedback, and propose **only
changes that will materially change future behaviour**.

**Read-only** — produces a report; the owner decides what to apply.

## Arguments

```
/session-learnings [--since YYYY-MM-DD] [--limit N]
```

`--since` drops older items, `--limit` processes only the N most recently modified session files.
Defaults: all sessions, all dates. Narrow only when asked.

## Principle

The script hands you raw owner messages with no keyword filter — you read each one and judge
whether it states a **durable rule**. Bias hard toward discard: the goal is fewer, sharper,
paste-ready changes, not encoding every transient request. A weak report (vague themes, one-off
singletons, restatements of rules we already have) is worse than none — it adds noise to the docs
and hides real signal in the next run.

## Steps

### 1. Extract

```bash
python3 scripts/llm/extract-session-messages.py --out <scratchpad>/session-messages.json
```

Each item: `session`, `ts`, `text`, `prior_assistant` (what Claude did right before — the context
that makes the message readable). **Read every item**; stream in chunks if they don't fit at once.

### 2. Classify

Default to Discard.

| Bucket            | What it is                                                    | Action  |
| ----------------- | ------------------------------------------------------------- | ------- |
| Rule / preference | how Claude should behave in general                           | Keep    |
| Correction        | a concrete correction whose reasoning generalises             | Keep    |
| Project rule      | a project or workflow fact (naming, branch flow, deploy step) | Keep    |
| One-shot          | tied to the task at hand ("not here, there")                  | Discard |
| Paste             | pasted logs, links, ticket or doc content                     | Discard |
| Flow              | "ok", "go on", "push", plain task instructions                | Discard |

Filter by generalisability, not by topic.

### 3. Cluster into themes

Group kept items by topic; list every quote with `session[:8]` + `ts[:10]`.

### 4. Check coverage — grep, don't recall

`docs/llm/**/*.md` · `docs/*.md` · `.claude/skills/*/SKILL.md` · `.claude/settings.json` · the
project memory dir (`MEMORY.md` and every file it links). Cite `path:section`; if you can't cite
one, it isn't covered.

| Coverage          | Default verdict                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fully covered     | repetition continues → **execution gap**: propose a hook, an earlier forward-pointer, or moving the rule to where it fires. Never restate.                               |
| Partially covered | refine the existing section — the exact sentence to add.                                                                                                                 |
| Not covered       | add to the closest doc; a new doc or skill only if nothing fits; a memory entry **only** for personal preferences, never for repo-wide rules (ENTRY_POINT § Core Rules). |

### 5. Propose

**Threshold:** ≥3 occurrences across ≥2 sessions, or a single message stating permanent policy in
the owner's own words ("никогда…", "всегда…"). Below that — discard.

Every proposal must pass all of:

1. **Behaviour change** — the next session does something different because of it. If not, drop it.
2. **Not a restatement** — a rule already stated in N places and still violated needs a hook or a
   better trigger, not an (N+1)th copy.
3. **Paste-ready** — exact file, exact section, exact text. "Consider adding something about X" is
   not a proposal.
4. **In the repo's voice** — terse imperative, no filler, held to the
   [quality bar](../../rules/llm-skills-guide.md#content-quality).
5. **No new docs, skills or renames unless the corpus forces it** — default to editing what exists.

Surface conflicts with existing rules instead of silently overriding them.

## Output

Save the report to the scratchpad as `session-learnings-<YYYY-MM-DD>.md`:

```
# Session Learnings — N sessions (DD.MM – DD.MM.YYYY)

**Stats**: X messages · Y kept · Z themes · W proposals

## ✅ Actionable

### 1. <Theme> (K occurrences in M sessions)

**Quotes**: (abc12345 · 2026-04-15) "<exact text>"
**Coverage**: none / partial in `path:section` / full in `path:section`
**Proposal**: `<file>` § "<section>" — add / replace with: "<exact text>"

## ❌ Discarded (representative)

- (abc12345) "<quote>" — one-shot / paste / covered in `path:section`

## Judgment calls to sanity-check

- <theme>: <what you chose over what>
```

No theme clears the bar → a one-line report saying so.
