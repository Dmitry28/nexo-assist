# /refine

Run the [self-check](../../rules/development-philosophy.md#self-check) on the most recent artifact — code diff, draft text, instruction, PR description, plan, anything.

## Per-lens output

- **Simple**: pass / what's over-complex
- **Clear**: pass / what's ambiguous
- **Concise**: pass / what to cut
- **DRY**: pass / what's duplicated (within the artifact or with existing docs/code)

If all four pass — say so and stop.
If any fail — list the concrete edits and apply them to the artifact.

If multiple recent artifacts could be the target, ask which one.
