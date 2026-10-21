---
name: review-code
description: Review changed files using team CCR rules. Use after completing a task, before creating PR, or when user asks for code review.
argument-hint: '[optional: PR URL/number, or a path/glob for a bulk audit]'
context: fork
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(gh *)
---

Arguments: $ARGUMENTS

Read and apply [docs/llm/commands/review/review-code.md](../../../docs/llm/commands/review/review-code.md).
