---
name: session-learnings
description: Analyze this project's Claude Code session logs, surface recurring owner corrections, check them against existing docs and skills, and propose targeted instruction updates. Read-only — produces a report.
argument-hint: '[--since YYYY-MM-DD] [--limit N]'
context: fork
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Write, Grep, Glob, Bash(python3 *), Bash(ls *), Bash(wc *)
---

Arguments: $ARGUMENTS

Read and apply [docs/llm/commands/llm/session-learnings.md](../../../docs/llm/commands/llm/session-learnings.md).
