# Kubernetes manifests

Plain manifests wired together with Kustomize — no Helm required.

Applied by CD on every merge to `dev` — `deploy/deploy.sh` pins the image of the deployed
commit and runs `kubectl apply -k`. Manual apply is the fallback when CI is unavailable:

```bash
# Pin the release first — the committed tag is a stale placeholder, so applying as-is
# would deploy whatever sha happens to be written in kustomization.yaml:
(cd k8s && kustomize edit set image nexo-assist=ghcr.io/dmitry28/nexo-assist:sha-<sha>)

kubectl apply -k k8s/            # what CD runs (after the pin above)
kubectl kustomize k8s/           # render without applying — exactly what will be sent
```

> On the server, do **not** `apply -k` the `/opt/nexo-assist` checkout after a failed
> deploy: `deploy.sh` leaves it pinned to the sha that just broke.

| File                 | Purpose                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configmap.yaml`     | Non-secret env. Credentials live in the `nexo-assist-secrets` Secret referenced by the deployment.                                                                                                                |
| `deployment.yaml`    | 1 replica (long-polling bot + in-memory pending prompts — see NOTE in the manifest), migrate initContainer, probes, resource limits, non-root + read-only-rootfs security context, Prometheus scrape annotations. |
| `service.yaml`       | ClusterIP on port 80 → container port 3000.                                                                                                                                                                       |
| `kustomization.yaml` | Ties the three together and pins the image; the committed tag is a placeholder — CD rewrites it with the sha it deploys.                                                                                          |

## Probes

- **Liveness** `/api/v1/health/live` — process up; failing restarts the pod.
- **Readiness** `/api/v1/health/ready` — dependencies healthy; failing pulls the pod
  out of the Service (no restart). Already pings the database; add further dependency
  checks in `health.controller.ts`.

## What is not in git

Two cluster objects are created by hand — everything else here is deployed from the repo.

**Secret `nexo-assist-secrets`** — `TELEGRAM_BOT_TOKEN`, `DATABASE_URL` (carries the
database password), `SCRAPE_PROXY_URL`, `SENTRY_DSN`. Create it **before** applying: the
app refuses to boot without the token and the `migrate` initContainer needs the URL.

```bash
npm run k8s:secrets   # deploy/secrets.sh — hidden input, values stay out of shell history
```

**ConfigMap `db-ca`** — the managed-Postgres provider's public root CA, mounted into both
containers and trusted via `NODE_EXTRA_CA_CERTS`. Without it `sslmode=verify-full` fails
with `SELF_SIGNED_CERT_IN_CHAIN`.

```bash
kubectl create configmap db-ca --from-file=ca.crt=<downloaded from the Supabase panel>.crt
```

Never commit real secrets. Keeping them encrypted in git (SOPS + age) is planned — see
[PRODUCT_PLAN.md](../docs/PRODUCT_PLAN.md); full context in
[docs/DEPLOY.md](../docs/DEPLOY.md).
