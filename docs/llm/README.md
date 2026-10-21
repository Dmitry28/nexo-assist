# docs/llm

LLM configuration and rules for nexo-assist — used by Claude Code and compatible agents.

## How it works

```
CLAUDE.md / AGENTS.md ─► docs/llm/ENTRY_POINT.md   (always-loaded context)
.claude/skills/*      ─► docs/llm/rules|commands/* (thin wrappers around these docs)
```

Single source of truth: content lives here in `docs/llm/`; skills only point at it. The one
agent, `.claude/agents/compressed-locator.md`, is self-contained (it wraps no skill): a read-only locator on a
cheap model.

## Structure

- `ENTRY_POINT.md` — always-loaded context; its Quick Reference table lists every rule.
- `rules/` — background knowledge, one doc per topic.
- `commands/` — instructions behind user-invocable skills.
- `mcp.example.json` — MCP servers reference.

## MCP Servers

See `mcp.example.json` for reference. Copy to `.mcp.json` in the project root (gitignored).

- **context7** — library docs lookup (NestJS, TypeScript, etc.).
- **github** — official hosted GitHub MCP server (OAuth on first use).
