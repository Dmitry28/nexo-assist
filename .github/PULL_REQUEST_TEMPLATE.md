## Summary

### User impact

<!-- Visible changes: new features, API changes, bug fixes affecting behaviour. Skip if none. -->

### Technical impact

<!-- Internal changes: refactors, dependency updates, CI, tooling, infrastructure. Skip if none. -->

## Test plan

<!-- What to test manually; edge cases to verify. -->

- [ ]

## Checklist

- [ ] Code follows project conventions (`docs/llm/rules/`)
- [ ] `npm run lint && npm run typecheck && npm test` pass locally
- [ ] Tests added/updated
- [ ] New env variable? Declared in `env.validation.ts`, documented in `.env.example`, and
      wired where it belongs — `configuration.ts` + `k8s/configmap.yaml` for ordinary settings,
      but a credential-like value skips `AppConfig` (the bootstrap logs it) and goes in the
      Secret via `deploy/secrets.sh`. Full procedure: `docs/llm/rules/architecture.md`
- [ ] No secrets or sensitive data committed
