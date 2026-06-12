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

```
docs/llm/
├── ENTRY_POINT.md           # Always-loaded context (project description, key commands)
├── README.md                # This file
├── mcp.example.json         # MCP servers reference (context7, github)
├── rules/                   # Background knowledge (one doc per topic, one skill per doc)
│   ├── development-philosophy.md  # DRY, KISS, SOLID
│   ├── code-style.md              # Naming, NestJS conventions
│   ├── typescript.md              # Type safety rules
│   ├── architecture.md            # Module structure, layer responsibilities
│   ├── workflow.md                # Plan → Implement → Verify → Fix
│   ├── code-review.md             # CCR labels, Pattern Check, triggers, process checks
│   ├── logic-review.md            # Behavior vs task: AC traceability, edge cases
│   ├── debugging.md               # Systematic debugging — Iron Law + 5 phases
│   ├── testing.md                 # AAA, fixtures, error paths, console rules
│   └── llm-skills-guide.md        # How to create/modify skills
└── commands/                # Instructions behind user-invocable skills
    ├── git/
    │   ├── commit-local-changes.md       # /git-commit
    │   ├── generate-pr-description.md    # /pr-description
    │   └── rules/
    │       └── changes-message-format-rules.md
    ├── review/
    │   ├── review-code.md                # /review-code
    │   └── logic-review.md               # /logic-review
    ├── check/
    │   ├── verify-task-result.md         # /verify-task-result
    │   └── refine.md                     # /refine
    └── llm/
        └── session-learnings.md          # /session-learnings (script: scripts/llm/)
```

## MCP Servers

See `mcp.example.json` for reference. Copy to `.mcp.json` in the project root (gitignored).

- **context7** — library docs lookup (NestJS, TypeScript, etc.).
- **github** — official hosted GitHub MCP server (OAuth on first use).
