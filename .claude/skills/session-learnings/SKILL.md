---
name: session-learnings
description: Scan Claude Code session logs for recurring user feedback and propose doc/skill/memory updates. Read-only report. Use when asked to mine sessions for lessons or improve LLM instructions from history.
argument-hint: '[--since YYYY-MM-DD] [--limit N]'
context: fork
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(python3 *), Write
---

Arguments: $ARGUMENTS

Read and apply [docs/llm/commands/llm/session-learnings.md](../../../docs/llm/commands/llm/session-learnings.md).
