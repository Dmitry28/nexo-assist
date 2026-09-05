#!/usr/bin/env bash
# Copy the newest database dump off the cluster — the off-site third copy.
#
#   ./deploy/fetch-backup.sh            # → ./backups/nexo-YYYY-MM-DD.sql.gz
#   ./deploy/fetch-backup.sh ~/Documents  # → into that directory (put it in iCloud)
#
# Why: the nightly dumps live on the app node. That already survives losing the database, but
# not losing the node. One copy on your laptop closes that, without paying for object storage.
set -euo pipefail

export KUBECONFIG=${NEXO_KUBECONFIG:-$HOME/.kube/nexo.yaml}
DEST=${1:-./backups}

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 1; }
kubectl get nodes >/dev/null 2>&1 || {
  echo "cluster unreachable — is the tunnel up? run ./deploy/tunnel.sh" >&2; exit 1
}

# The dumps live on a volume, not in a running pod, so borrow a short-lived one to read them.
# NOTE: the CronJob's own pods are gone by then — attaching to the volume is the only way in.
POD=nexo-backup-fetch-$RANDOM
cleanup() { kubectl delete pod "$POD" --now --ignore-not-found >/dev/null 2>&1 || true; }
trap cleanup EXIT

kubectl run "$POD" --restart=Never --image=busybox:1.37 \
  --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":1000},"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"nexo-assist-backups"}}],"containers":[{"name":"c","image":"busybox:1.37","command":["sleep","300"],"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}},"volumeMounts":[{"name":"b","mountPath":"/backups"}]}]}}' >/dev/null
kubectl wait --for=condition=Ready "pod/$POD" --timeout=60s >/dev/null

# *.part is a dump still being written (or one that died mid-write) — never hand that over.
NEWEST=$(kubectl exec "$POD" -- sh -c 'ls -1t /backups/*.sql.gz 2>/dev/null | head -1')
[[ -n "$NEWEST" ]] || { echo "no dumps yet — the CronJob runs at 03:00 UTC" >&2; exit 1; }

mkdir -p "$DEST"
kubectl cp "$POD:$NEWEST" "$DEST/$(basename "$NEWEST")"
ls -lh "$DEST/$(basename "$NEWEST")"
echo "keep a copy somewhere synced (iCloud, a password manager attachment)"
