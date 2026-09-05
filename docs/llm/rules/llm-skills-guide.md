# LLM Skills Guidelines

## Core Principles

1. **Skills are thin wrappers** — `.claude/skills/<name>/SKILL.md` contains only frontmatter + a one-line link to content.
2. **Content co-located** — rules live in `docs/llm/rules/`, command instructions in `docs/llm/commands/`.
3. **One link only** — a skill references one main doc; that doc can link to others internally.
4. **Reusable across IDEs** — works in Claude Code, Cursor, etc.

## Content Quality

Rules and skills must be:

- **Correct** — verify every claim against current code; outdated guidance is worse than no guidance.
- **Simple, clear, concise** — easy to understand at a glance.
- **DRY** — state each rule in one canonical place; link to it from elsewhere instead of duplicating.
- **Essential only** — no redundant explanations or excessive examples.
- **Non-obvious only** — skip what an LLM can easily infer from the code.
- **Actionable** — focus on what to do, not what not to do.
- **Cold-reread before finalizing** — read the final text as someone without your context: catch
  self-contradictions, and cut qualifiers (_especially_, _mainly_) that fit the example you had in
  mind but not the general rule.
- **Idiomatic** — skill/command mechanics follow the
  [Claude Code docs](https://code.claude.com/docs/en/overview) and
  [Cookbook](https://github.com/anthropics/claude-cookbooks); don't invent local conventions
  where an official one exists.

## Cross-references

Inside a rule body, reference other rules by **relative path** (`see ./debugging.md`), never by `@`-import — `@` is reserved for `CLAUDE.md`. This avoids cascading auto-imports and keeps each rule self-contained.

## When NOT to Create a Skill

A skill exists to give Claude **discoverability** (auto-load on triggers) or **a slash command**. If neither is needed, keep the markdown rule and skip the wrapper:

- Content fits in `CLAUDE.md`/`ENTRY_POINT.md` (a few lines of project-wide context).
- It's referenced from one place only — inline it there.

## Skill File Format (`.claude/skills/<name>/SKILL.md`)

8–15 lines total. The filename must be exactly `SKILL.md` — nothing else is discovered.

```yaml
---
name: skill-name
description: Brief description. Use when [specific triggers].
user-invocable: false
allowed-tools: Read
---
Read and apply [topic] rules from [docs/llm/rules/topic.md](../../../docs/llm/rules/topic.md).
```

### Frontmatter

Fields and their defaults — [Claude Code docs](https://code.claude.com/docs/en/skills); don't
restate them here. Our choices:

- **Background rule** (auto-loaded on triggers): `user-invocable: false` — the default is `true`.
- **Command** (`/name` only): `disable-model-invocation: true`.
- **Large output** (diffs, reviews, PR descriptions): `context: fork`, so the output stays out of
  the main conversation.

**`allowed-tools` grants, it does not gate.** It pre-approves the listed tools for that turn —
everything else still works, it just prompts, which silently stalls an unattended run. The field
that removes a tool is `disallowed-tools`. List what the skill's doc actually tells it to run;
`.claude/settings.json` already pre-approves much of it project-wide.

**Bash patterns:** `Bash(npm:*)` and `Bash(npm *)` are equivalent, but the `:*` shorthand is only
recognized at the **end** of a pattern — `Bash(npm:ci)` matches the literal string `npm:ci`, never
`npm ci`.

### Body beyond the link

Two things may precede the link to the content doc; everything else belongs in that doc:

- `$ARGUMENTS` — the argument string as typed (`Arguments: $ARGUMENTS`); `$0`, `$1` for positional.
- `` !`<command>` `` — runs before the skill reaches Claude and substitutes its output, so the
  skill opens with live data (``Current branch: !`git branch --show-current` ``). The command needs
  its own `allowed-tools` entry.

### Description rules

One line, ≤200 chars (the platform allows more, but every description is loaded in every
session). Specific — file types, domain terms, action verbs — and phrased as a positive trigger:

- ✅ "Code review rules — CCR labels and checklist. Use when reviewing PRs."
- ❌ "Use when writing code" (too broad).

## Adding a New Skill

1. Create content file in `docs/llm/rules/` or `docs/llm/commands/`.
2. Create skill wrapper in `.claude/skills/<name>/SKILL.md` — the frontmatter is the single source for the skill's description/triggers; no separate registration anywhere.
3. **Final pass** — re-read the content file: correct (verified, no recall)? DRY (link instead of duplicate)? concise (cut what loses nothing)? clear to a new contributor? If any "no" — revise before committing. Sloppy skills compound — they get followed and copied.
4. **Format check** — markdown skips lint-staged's ESLint, so run `npx prettier --check <file>` on every modified instruction file; fix with `--write`.
