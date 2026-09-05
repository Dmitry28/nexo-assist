# Dependencies

## Never regenerate `package-lock.json` on macOS

Deleting the lock and running `npm install` drops **Linux-only optional** native bindings that the
lock carries for CI and the Docker build — ours are `@unrs/resolver-binding-*` (eslint's import
resolver), including the `wasm32-wasi` fallback. Local stays green, then `npm ci` fails on Linux.

- Out of sync → `npm install` to reconcile the lock **in place**; never `rm package-lock.json`.
- After any `npm install` / `npm update`, check the bindings survived before pushing:

  ```bash
  grep -c resolver-binding-wasm32-wasi package-lock.json   # must be > 0
  ```

- Pruned (count `0`) → restore the lock hunks with `git checkout`, or regenerate inside a Linux
  container. Re-running `npm install` on macOS prunes them again.

## Bumping

- Bump peer-locked families together (the whole eslint or nest stack) — one package alone fails on
  peer conflicts even when the group would install cleanly.
- A major that can't install is a **blocker to record**, not a fight to win: revert
  (`git checkout -- package.json package-lock.json && npm install`) and note the reason in the
  backlog ([PRODUCT_PLAN.md](../../PRODUCT_PLAN.md)).
- Stale `node_modules` after a branch switch produce phantom `tsc` / jest failures — `npm ci`
  before believing them.

## Triaging `npm audit`

Classify by **exploitable surface**, not by the severity number — walk `npm ls <pkg>` to see how
the package is actually reached:

| Class           | What it means                                      | Action       |
| --------------- | -------------------------------------------------- | ------------ |
| Not exploitable | dev/build tooling, or a runtime path we never call | none         |
| Operator-only   | reachable only by us (scripts, admin commands)     | watch-list   |
| Untrusted input | touches scraped pages or Telegram messages         | **must fix** |

Must-fix means bump, override, or a documented blocker — not a severity note in the PR.
