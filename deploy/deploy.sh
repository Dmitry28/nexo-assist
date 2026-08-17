#!/usr/bin/env bash
# Deploy one commit of nexo-assist to the k3s cluster running on this host.
#
# Canonical copy — installed to /usr/local/bin/deploy.sh by setup-server.sh. Edit it here, push
# to the deploy ref, then re-run setup-server.sh on the host: it installs what is pushed, not a
# local edit. The running copy is deliberately NOT the one in the checkout — this script replaces
# that checkout mid-run, and bash reads scripts incrementally.
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
KUSTOMIZATION="$REPO_DIR/k8s/kustomization.yaml"
sed -i "s|newTag: .*|newTag: sha-${SHORT}|" "$KUSTOMIZATION"

# Confirm the pin against the RENDERED manifests, not the file text. sed exits 0 when it matched
# nothing, and it rewrites every `newTag:` line (comments included) — so a file-level grep can
# pass while the image that actually deploys is the stale committed placeholder. Rendering
# answers the only question that matters: which image will `apply` use?
# NOTE: capture first — `kustomize … | grep -q` is the pipefail/SIGPIPE trap in DEPLOY.md.
# Kept as sed + check rather than `kustomize edit set image`: that needs the standalone kustomize
# binary on the host (k3s embeds only the build path), and this manifest has one image.
UNTOUCHED="deploy: nothing applied, production untouched; checkout left at ${SHORT} — do NOT 'apply -k' it manually"
RENDERED=$(k3s kubectl kustomize "$REPO_DIR/k8s/") || {
  echo "deploy: rendering ${REPO_DIR}/k8s/ failed — cannot verify which image would deploy" >&2
  echo "$UNTOUCHED" >&2
  exit 2
}
# TODO: assert ALL rendered image lines are equal to the expected one (sort -u) instead of these
# two greps — an image renamed to e.g. `nexo-assist-migrate:` matches neither and passes [M].
# Both conditions matter: our tag must be there, AND no unsubstituted `nexo-assist:` placeholder
# may survive — one `images:` entry rewrites both containers today, but nothing enforces that, so
# a second image name would otherwise leave a partial pin that still passes the positive check.
# -F: fixed string. The dots in the registry name would otherwise match any character, and a
# near-miss registry passing this check is the one outcome it exists to prevent.
if ! grep -qF "image: ${IMAGE}:sha-${SHORT}" <<<"$RENDERED" ||
  grep -qF 'image: nexo-assist:' <<<"$RENDERED"; then
  echo "deploy: rendered manifests don't all use ${IMAGE}:sha-${SHORT} — check newTag/newName in ${KUSTOMIZATION} and the image names in k8s/deployment.yaml" >&2
  echo "$UNTOUCHED" >&2
  exit 2
fi

# Remember what is live BEFORE we change anything: a bare `rollout undo` means "one revision
# back", which is NOT the same as "what was running". Re-deploying the sha already live creates
# no new revision, so a bare undo would then downgrade a release further than intended.
# Empty on the very first deploy (no Deployment yet) — handled in the rollback branch.
REV_BEFORE=$(k3s kubectl get deployment/nexo-assist \
  -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null || true)

echo "deploy: applying manifests"
k3s kubectl apply -k "$REPO_DIR/k8s/"

# Roll back if the new pod never becomes ready (broken migrations, missing image, crash on boot).
# This matters more than usual here: one replica with strategy Recreate means the old pod is
# stopped BEFORE the new one starts, so a bad deploy leaves the bot down — and CD is automatic,
# so nobody is necessarily watching. Reverting restores the last pod template that did run.
#
# NOTE: reverts the pod template only — not the DB schema and not the ConfigMap/Secret.
# See docs/DEPLOY.md § «Откат» for what that means in practice.
#
# Timeout: a healthy deploy (fresh image pull + migrate initContainer + startupProbe) measured
# ~22 s, so 180 s is ample. Deliberately not longer: with Recreate the bot is already down while
# we wait, so a bigger budget only stretches the outage on a genuinely broken release, whereas
# a premature rollback costs a failed release, not availability.
if ! k3s kubectl rollout status deployment/nexo-assist --timeout=180s; then
  echo "deploy: ${SHORT} failed to become ready — rolling back" >&2
  # The checkout stays on the failed commit with its tag pinned in kustomization.yaml —
  # say so on EVERY failure path, since the next step a human takes is often `apply -k`.
  echo "deploy: host checkout left at ${SHORT} — do NOT 'apply -k' it manually" >&2

  # Capture the evidence FIRST: rolling back scales the failed ReplicaSet to zero and its pod
  # (with the reason it died) disappears. This job log becomes the only record. `|| true` —
  # diagnostics must never be the thing that stops us from restoring service.
  {
    echo "deploy: --- why it failed (pod state, then logs) ---"
    k3s kubectl describe pod -l app.kubernetes.io/name=nexo-assist 2>&1 | tail -40 || true
    k3s kubectl logs -l app.kubernetes.io/name=nexo-assist --all-containers --tail=100 2>&1 || true
    echo "deploy: --- end diagnostics ---"
  } >&2

  if [[ -z "$REV_BEFORE" ]]; then
    echo "deploy: no previous revision (first deploy) — the bot is DOWN, fix it by hand" >&2
    exit 1
  fi
  k3s kubectl rollout undo deployment/nexo-assist --to-revision="$REV_BEFORE" || {
    echo "deploy: rollback to revision ${REV_BEFORE} failed — the bot is DOWN, fix it by hand" >&2
    exit 1
  }
  if k3s kubectl rollout status deployment/nexo-assist --timeout=180s; then
    echo "deploy: rolled back — the bot is up on the previous version, ${SHORT} was NOT deployed" >&2
  else
    echo "deploy: ROLLBACK ALSO FAILED — the bot is DOWN, fix it by hand" >&2
  fi
  exit 1
fi
echo "deploy: ${IMAGE}:sha-${SHORT} is live"
