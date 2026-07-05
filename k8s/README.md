# Kubernetes manifests

Plain manifests wired together with Kustomize — no Helm required.

```bash
# Build & push your image first, then:
kubectl apply -k k8s/

# Pin the image for a release:
cd k8s && kustomize edit set image nexo-assist=registry/nexo-assist:<git-sha>
```

| File              | Purpose                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `configmap.yaml`  | Non-secret env. Credentials live in the `nexo-assist-secrets` Secret referenced by the deployment.                                                                                         |
| `deployment.yaml` | 1 replica (long-polling bot + in-memory pending prompts — see NOTE in the manifest), probes, resource limits, non-root + read-only-rootfs security context, Prometheus scrape annotations. |
| `service.yaml`    | ClusterIP on port 80 → container port 3000.                                                                                                                                                |

## Probes

- **Liveness** `/api/v1/health/live` — process up; failing restarts the pod.
- **Readiness** `/api/v1/health/ready` — dependencies healthy; failing pulls the pod
  out of the Service (no restart). Add DB/cache checks in `health.controller.ts`.

## Secrets

Create a `Secret` named `nexo-assist-secrets` with `TELEGRAM_BOT_TOKEN` and
`DATABASE_URL` (the Neon URL — it carries a password) **before** applying: the
app refuses to boot without the token, and the `migrate` initContainer needs the
database URL. For example:

```bash
kubectl create secret generic nexo-assist-secrets \
  --from-literal=TELEGRAM_BOT_TOKEN='123:abc' \
  --from-literal=DATABASE_URL='postgres://user:pass@ep-xxx.neon.tech/db?sslmode=verify-full'
```

Never commit real secrets — for GitOps use a sealed-secrets / external-secrets
operator or your platform's secret manager.
