---
name: logic-review
description: Review feature behavior against the task — acceptance criteria, edge cases, security, performance. No args — local branch vs origin/dev; with a GitHub PR URL/number — that PR. Launch together with /review-code after completing a task.
argument-hint: '[optional: GitHub PR URL or number]'
context: fork
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(gh *)
---

Arguments: $ARGUMENTS

Read and apply [docs/llm/commands/review/logic-review.md](../../../docs/llm/commands/review/logic-review.md).
