# Kubernetes manifests

Plain manifests wired together with Kustomize — no Helm required.

```bash
# Build & push your image first, then:
kubectl apply -k k8s/

# Pin the image for a release:
cd k8s && kustomize edit set image nexo-assist=registry/nexo-assist:<git-sha>
```

| File              | Purpose                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configmap.yaml`  | Non-secret env. Credentials live in the `nexo-assist-secrets` Secret referenced by the deployment.                                                                               |
| `deployment.yaml` | 1 replica (long-polling bot + in-memory state — see NOTE in the manifest), probes, resource limits, non-root + read-only-rootfs security context, Prometheus scrape annotations. |
| `service.yaml`    | ClusterIP on port 80 → container port 3000.                                                                                                                                      |

## Probes

- **Liveness** `/api/v1/health/live` — process up; failing restarts the pod.
- **Readiness** `/api/v1/health/ready` — dependencies healthy; failing pulls the pod
  out of the Service (no restart). Add DB/cache checks in `health.controller.ts`.

## Secrets

Create a `Secret` named `nexo-assist-secrets` with `TELEGRAM_BOT_TOKEN` **before**
applying — the deployment references it, and production refuses to boot without
the token. Never commit real secrets — use a sealed-secrets / external-secrets
operator or your platform's secret manager.
