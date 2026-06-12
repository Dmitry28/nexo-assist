---
name: git-commit
description: Generate commit message and propose git commit for staged changes. Use when user asks to commit, create commit, or save changes.
argument-hint: '[optional: custom commit message]'
context: fork
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash(git *)
---

Current branch: !`git branch --show-current`

Read and apply git commit workflow from [docs/llm/commands/git/commit-local-changes.md](../../../docs/llm/commands/git/commit-local-changes.md).
