---
name: pr-description
description: Generate GitHub PR title and description for all changes in the current branch. Use when user asks to create PR, generate PR description, or prepare changes for review.
argument-hint: '[optional: additional context]'
context: fork
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash(git *)
---

Current branch: !`git branch --show-current`

Read and apply PR description workflow from [docs/llm/commands/git/generate-pr-description.md](../../../docs/llm/commands/git/generate-pr-description.md).
