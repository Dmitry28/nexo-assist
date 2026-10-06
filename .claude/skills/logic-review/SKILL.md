---
name: logic-review
description: Review behavior against the task — acceptance criteria, edge cases, security, performance. Args — none, a PR URL/number, or the task as text. Launch with /review-code after a task.
argument-hint: '[optional: GitHub PR URL/number, or the task + agreed plan as text]'
context: fork
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(gh *)
---

Arguments: $ARGUMENTS

Read and apply [docs/llm/commands/review/logic-review.md](../../../docs/llm/commands/review/logic-review.md).
