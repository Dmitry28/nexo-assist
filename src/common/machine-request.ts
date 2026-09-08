/**
 * Whether a request path belongs to infrastructure rather than to a user — the orchestrator's
 * liveness/readiness probes and the Prometheus scrape.
 *
 * `base` is the versioned API root (`/api/v1`), passed in rather than read from the environment
 * so this stays a pure function: the prefix and version are configurable, and hardcoding either
 * would make the predicate quietly stop matching the day one of them changes.
 */
export const isMachineRequest = ({ path, base }: { path: string; base: string }): boolean =>
  path.startsWith(`${base}/health`) || path === `${base}/metrics`;
