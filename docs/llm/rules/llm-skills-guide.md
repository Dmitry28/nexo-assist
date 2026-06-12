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

## Cross-references

Inside a rule body, reference other rules by **relative path** (`see ./debugging.md`), never by `@`-import — `@` is reserved for `CLAUDE.md`. This avoids cascading auto-imports and keeps each rule self-contained.

## When NOT to Create a Skill

A skill exists to give Claude **discoverability** (auto-load on triggers) or **a slash command**. If neither is needed, keep the markdown rule and skip the wrapper:

- Content fits in `CLAUDE.md`/`ENTRY_POINT.md` (a few lines of project-wide context).
- It's referenced from one place only — inline it there.

## Skill File Format (`.claude/skills/<name>/SKILL.md`)

8–15 lines total.

```yaml
---
name: skill-name
description: Brief description. Use when [specific triggers].
user-invocable: false
allowed-tools: Read
---

Read and apply [topic] rules from [docs/llm/rules/topic.md](../../../docs/llm/rules/topic.md).
```

### Frontmatter fields

| Field                      | Required | Description                                                                                            |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `name`                     | yes      | Skill identifier, used in `/name`.                                                                     |
| `description`              | yes      | Trigger description, under 200 chars.                                                                  |
| `user-invocable`           | no       | Show in `/` menu (default: `false`).                                                                   |
| `disable-model-invocation` | no       | Only user can invoke (default: `false`).                                                               |
| `context`                  | no       | `conversation` (default) — runs in current context; `fork` — runs in isolated context, returns summary. |
| `argument-hint`            | no       | Placeholder hint shown after `/name` in menu.                                                          |
| `allowed-tools`            | no       | Restrict available tools for this skill.                                                               |

### Description rules

- **Specific** — mention file types, features, or actions.
- **Positive triggers** — "Use when working with…" (not "Do NOT use for…").
- **Concise** — under 200 chars.
- **Keyword-rich** — file extensions, domain terms, action verbs.

Examples:

- ✅ "Code review rules — CCR labels and checklist. Use when reviewing PRs."
- ❌ "Use when writing code" (too broad).

## Skill Types

| Type           | Config                                                       | When triggered                      |
| -------------- | ------------------------------------------------------------ | ----------------------------------- |
| **Background** | `user-invocable: false`                                      | Auto-loaded by Claude when relevant |
| **Command**    | `user-invocable: true` + `disable-model-invocation: true`    | Only via `/skill-name`              |
| **Hybrid**     | `user-invocable: true` + `disable-model-invocation: false`   | Both Claude and `/skill-name`       |

Command skills with large output (diffs, reviews, PR descriptions) should use `context: fork` to avoid polluting the main conversation context.

## Adding a New Skill

1. Create content file in `docs/llm/rules/` or `docs/llm/commands/`.
2. Create skill wrapper in `.claude/skills/<name>/SKILL.md` — the frontmatter is the single source for the skill's description/triggers; no separate registration anywhere.
3. **Final pass** — re-read the content file: correct (verified, no recall)? DRY (link instead of duplicate)? concise (cut what loses nothing)? clear to a new contributor? If any "no" — revise before committing. Sloppy skills compound — they get followed and copied.
4. **Format check** — markdown skips lint-staged's ESLint, so run `npx prettier --check <file>` on every modified instruction file; fix with `--write`.
