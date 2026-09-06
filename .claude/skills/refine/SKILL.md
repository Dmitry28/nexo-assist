---
name: refine
description: Apply the simple / clear / concise / DRY self-check to the most recent artifact (code, draft, instruction, PR description). Use when the user asks to refine, polish, simplify, or "check the result".
user-invocable: true
allowed-tools: Read, Edit, Write
---

Run the [self-check](../../../docs/llm/rules/development-philosophy.md#self-check) on the most
recent artifact — a diff, a draft text, an instruction, a PR description, a plan, anything.

One line per lens: pass, or the concrete problem. DRY is checked against the rest of the repo too,
not only inside the artifact.

All pass → say so and stop. Any fail → list the concrete edits and apply them to the artifact.

If several recent artifacts could be the target, ask which one.
