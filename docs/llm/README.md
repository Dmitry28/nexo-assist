# docs/llm

LLM configuration and rules for nexo-assist — used by Claude Code and compatible agents.

## How it works

```
CLAUDE.md / AGENTS.md ─► docs/llm/ENTRY_POINT.md   (always-loaded context)
.claude/skills/*      ─► docs/llm/rules|commands/* (thin wrappers around these docs)
.claude/agents/*      ─► .claude/skills/*          (isolated runners on cheap models)
```

Single source of truth: content lives here in `docs/llm/`; skills and agents only point at it. Skill descriptions/triggers live in each `.claude/skills/<name>/SKILL.md` frontmatter — they are not duplicated here.

## Structure

- `ENTRY_POINT.md` — always-loaded context; its Quick Reference table lists every rule.
- `rules/` — background knowledge, one doc per topic.
- `commands/` — instructions behind user-invocable skills (`/git-commit`, `/review-code`,
  `/logic-review`, `/pr-description`, `/verify-task-result`, `/refine`, `/session-learnings`).
- `mcp.example.json` — MCP servers reference.
- `scripts/llm/` (repo root) — tooling a command needs, e.g. the session-log extractor behind
  `/session-learnings`.

## MCP Servers

See `mcp.example.json` for reference. Copy to `.mcp.json` in the project root (gitignored).

- **context7** — library docs lookup (NestJS, TypeScript, etc.).
- **github** — official hosted GitHub MCP server (OAuth on first use).
