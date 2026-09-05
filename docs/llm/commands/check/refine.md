# /refine

Run the [self-check](../../rules/development-philosophy.md#self-check) on the most recent
artifact — a diff, a draft text, an instruction, a PR description, a plan, anything.

## Per-lens output

- **Simple** — pass / what is over-complex
- **Clear** — pass / what is ambiguous
- **Concise** — pass / what to cut
- **DRY** — pass / what is duplicated (inside the artifact or against existing docs/code)
- **Lean** — pass / what anticipates a future that isn't here
- **Idiomatic** — pass / where it departs from peer code without reason

All pass → say so and stop. Any fail → list the concrete edits and apply them to the artifact.

If several recent artifacts could be the target, ask which one.
