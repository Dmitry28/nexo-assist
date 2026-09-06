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
- [ ] New env variable? All four updated: `env.validation.ts` + `configuration.ts` +
      `.env.example` + `k8s/configmap.yaml` (see `docs/llm/rules/architecture.md`)
- [ ] No secrets or sensitive data committed
