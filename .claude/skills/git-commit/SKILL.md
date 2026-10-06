---
name: git-commit
description: Commit an owner-approved, staged diff with a generated message. Use when the owner approves a diff or asks to commit.
argument-hint: '[optional: custom commit message]'
context: fork
user-invocable: true
allowed-tools: Bash(git *), Bash(npm *), Bash(npx *)
---

Current branch: !`git branch --show-current`

Read and apply git commit workflow from [docs/llm/commands/git/commit-local-changes.md](../../../docs/llm/commands/git/commit-local-changes.md).
