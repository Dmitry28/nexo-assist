# Session Learnings

Scan Claude Code session logs for this project, find recurring user feedback, and propose **only changes that will materially change future behaviour**.

**Read-only.** Produces a report; the user decides what to apply.

See [llm-skills-guide](../../rules/llm-skills-guide.md) for skill/doc authoring rules.

## Arguments

```
/session-learnings [--since YYYY-MM-DD] [--limit N]
```

- `--since` — drop items older than this date. Default: no cutoff (all sessions).
- `--limit` — process only N most recently modified session files. Default: all.

## Principle

The script gives you raw user messages — no keyword filter. Read each one and judge: does this state a **durable rule** the user wants enforced? Bias hard toward discard. The goal is **fewer, sharper, paste-ready** changes — not encoding every transient request, not restating rules that already exist.

A weak report (vague themes, low-frequency singletons, restatements of covered rules) is worse than no report.

## Steps

### 1. Extract messages

Run from the repo root (the script derives the session dir from cwd):

```bash
python3 scripts/llm/extract-session-messages.py --out /tmp/session-messages.json
```

Output items: `session`, `ts`, `text`, `prior_assistant` (snippet of what Claude did right before — needed for context). **Read every item**; if they don't fit in one pass, stream in chunks of ~500 and accumulate themes.

### 2. Classify each message

Use text + prior_assistant for context. Default to Discard.

| Bucket            | Definition                                                          | Action  |
| ----------------- | ------------------------------------------------------------------- | ------- |
| Rule / preference | User states how Claude should behave generally                      | Keep    |
| Correction        | Concrete correction with reasoning that generalises beyond the task | Keep    |
| Project rule      | Project / workflow fact (naming, release flow, conventions)         | Keep    |
| One-shot          | Tied to current task only ("not here, there")                       | Discard |
| Paste             | Pasted external content (tickets, emails, logs)                     | Discard |
| Flow              | "ok", "yes", "push", task instructions                              | Discard |

Filter by generalisability, not by topic.

### 3. Cluster kept items into themes

Group by topic. For each theme, list every quote with `session[:8]` + `ts[:10]`.

### 4. Check coverage

For every theme, actually grep — don't recall:

- `docs/llm/**/*.md`
- `.claude/skills/*/SKILL.md` and `.claude/settings.json`
- The project memory dir (same cwd-slug rule as the script); read `MEMORY.md` and every file it links

Cite `path:section` in the verdict. If you can't cite a path, it's not covered.

| Coverage          | Default verdict                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Fully covered     | If repetition continues → **execution gap**. Propose a hook, a forward-pointer earlier in the workflow, or move the rule closer to where it fires. Never restate. |
| Partially covered | Refine the existing section — exact bullet/sentence to add.                                                                                    |
| Not covered       | Add to closest doc · new doc/skill · MEMORY entry only for genuinely personal preferences.                                                     |

Personal-vs-team boundary: rules the whole team should follow → `docs/llm/` / `.claude/`. MEMORY is only for individual preferences.

### 5. Propose

**Hard threshold**: ≥5 occurrences across ≥3 distinct sessions OR a singleton stating explicit permanent policy in the user's own words ("никогда не …", "всегда …"). Borderline themes (2–4 occurrences) → discard unless the wording is policy-grade and high-stakes.

**Worthwhile test — apply to every proposal:**

1. **Behaviour change**: will the next contributor (human or Claude) do something different because of this edit? If "no" — drop it.
2. **Not a restatement**: if the rule exists in N places and is still violated, an (N+1)th copy is noise — propose a hook, a tighter trigger, or move the rule to where it fires.
3. **Concrete and paste-ready**: exact file, exact section, exact text.
4. **No AI-tone in proposed text**: terse imperative, match the user's voice.
5. **No new docs/skills unless the corpus forces it.** Default to editing existing files.

Surface conflicts with existing rules instead of overriding silently.

## Output

Save the report to `/tmp/session-learnings-<YYYY-MM-DD>.md`.

```
# Session Learnings — N sessions (DD.MM – DD.MM.YYYY)

**Stats**: X messages · Y validated · Z themes · W proposals

## ✅ Actionable

### 1. <Theme> (K occurrences in M sessions)

**Quotes**:
- (abc12345 · 2026-06-01) "<exact text>"

**Coverage**: <none / partial in `path:section` / fully in `path:section`>

**Proposals**:
- `<file>` § "<section>" — replace "<old>" with "<new>" / add: "<exact text>"

## ❌ Discarded (representative)

- (abc12345) "<quote>" — paste / one-shot / fully covered in `path:section`

## Judgment calls the reviewer should sanity-check

- <theme number>: <what you chose vs the alternative>
```

If after analysis no theme clears the bar — output a one-line report saying so. **A weak report is worse than no report.**
