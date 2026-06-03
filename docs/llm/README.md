# docs/llm

LLM configuration and rules for nexo-assist — used by Claude Code and compatible agents.

## How it works

```
CLAUDE.md ─┐
AGENTS.md ─┴─► docs/llm/ENTRY_POINT.md ─► .claude/skills/*  (rules)
                                       ─► .claude/agents/*  (auto-triggered agents)
```

## Structure

```
docs/llm/
├── ENTRY_POINT.md           # Always-loaded context (project description, key commands)
├── README.md                # This file
├── mcp.example.json         # MCP servers reference (context7, github)
├── rules/
│   ├── development-philosophy.md  # DRY, KISS, SOLID
│   ├── code-style.md              # Naming, NestJS conventions
│   ├── typescript.md              # Type safety rules
│   ├── architecture.md            # Module structure, layer responsibilities
│   ├── workflow.md                # Plan → Implement → Verify → Fix
│   ├── code-review.md             # CCR labels [H][M][L][D][Q]
│   └── llm-skills-guide.md        # How to create/modify skills
└── commands/
    ├── git/
    │   ├── commit-local-changes.md
    │   ├── generate-pr-description.md
    │   └── rules/
    │       └── changes-message-format-rules.md
    ├── review/
    │   └── review-code.md
    └── check/
        └── verify-task-result.md
```

## Skills

| Skill                    | Type       | When                                                  |
| ------------------------ | ---------- | ----------------------------------------------------- |
| `development-philosophy` | background | Architectural decisions, designing features           |
| `code-style`             | background | Formatting, renaming, naming conventions              |
| `typescript`             | background | Fixing type errors, working with types/interfaces     |
| `architecture`           | background | Placing files, structuring new features               |
| `code-review`            | background | Reviewing PRs, applying CCR labels                    |
| `workflow`               | background | Planning tasks, structuring complex work              |
| `llm-skills-guide`       | background | Creating or modifying skills                          |
| `git-commit`             | command    | `/git-commit` — generate and propose commit           |
| `pr-description`         | command    | `/pr-description` — generate GitHub PR title + body   |
| `verify-task-result`     | command    | `/verify-task-result` — lint + tsc + tests + build    |
| `review-code`            | command    | `/review-code` — review all branch changes via CCR    |

## Agents

| Agent                | Model  | When auto-triggered                          |
| -------------------- | ------ | -------------------------------------------- |
| `verify-task-result` | haiku  | After completing any code changes            |
| `review-code`        | sonnet | After completing a task, before creating PR  |

## MCP Servers

See `mcp.example.json` for reference. Copy to `.mcp.json` in the project root and fill in tokens.

Useful servers:

- **context7** — library docs lookup (NestJS, TypeScript, etc.).
- **github** — GitHub API (issues, PRs, repo info).
