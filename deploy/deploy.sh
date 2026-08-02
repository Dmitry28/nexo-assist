#!/usr/bin/env bash
# Deploy one commit of nexo-assist to the k3s cluster running on this host.
#
# Canonical copy — installed to /usr/local/bin/deploy.sh by setup-server.sh. Edit it here,
# then re-run setup-server.sh on the host (the running copy is deliberately NOT the one in the
# checkout: this script replaces that checkout mid-run, and bash reads scripts incrementally).
#
# Invoked only through SSH with a forced command (see setup-server.sh), so the CD key can do
# this and nothing else. The commit sha arrives in SSH_ORIGINAL_COMMAND and is validated
# strictly: it is interpolated into git/kubectl arguments, so anything but hex must be rejected.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/nexo-assist}
IMAGE=${IMAGE:-ghcr.io/dmitry28/nexo-assist}
export KUBECONFIG=${KUBECONFIG:-/home/deploy/.kube/config}

SHA="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if [[ ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "deploy: expected a commit sha, got: '${SHA}'" >&2
  exit 2
fi
SHORT="${SHA:0:7}"

echo "deploy: checking out ${SHORT}"
git -C "$REPO_DIR" fetch --quiet origin
git -C "$REPO_DIR" checkout --quiet --force "$SHA"

# Pin the image built for this very commit (immutable tag). The tag committed in the manifest
# is only a placeholder for manual applies — CD always deploys the image of the deployed commit.
sed -i "s|newTag: .*|newTag: sha-${SHORT}|" "$REPO_DIR/k8s/kustomization.yaml"

echo "deploy: applying manifests"
k3s kubectl apply -k "$REPO_DIR/k8s/"
# Fail the CD job if the new pod never becomes ready (broken migrations, missing image, ...).
k3s kubectl rollout status deployment/nexo-assist --timeout=180s
echo "deploy: ${IMAGE}:sha-${SHORT} is live"
