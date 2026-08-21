#!/usr/bin/env bash
# Create or update the cluster Secret the app reads at startup.
#
#   ./deploy/secrets.sh            # prompts for every value (input hidden)
#   ./deploy/secrets.sh SENTRY_DSN # prompts for one value, leaves the rest untouched
#
# Values are typed at a prompt, never passed as arguments — a command line ends up in the shell
# history and in the process list. Nothing is echoed back and nothing is written to disk.
#
# The Secret is the ONLY place the app reads these from, and it is not in git. Keep the values in
# a password manager: after a cluster rebuild this script restores them in one command. (A proper
# fix — encrypted secrets committed to git via SOPS+age — is a planned step, see PRODUCT_PLAN.)
#
# Restart after changing a value: env vars are injected when a container starts, so an existing
# pod keeps the old ones —  kubectl rollout restart deployment/nexo-assist
set -euo pipefail

# Pin our kubeconfig: writing production secrets into whatever cluster the ambient KUBECONFIG
# happens to point at would be a silent, serious mistake.
export KUBECONFIG=${NEXO_KUBECONFIG:-$HOME/.kube/nexo.yaml}

SECRET=${SECRET:-nexo-assist-secrets}
# ADMIN_TELEGRAM_ID is not a credential, but it is the owner's personal Telegram id and the
# repo is public — so it lives here rather than in the ConfigMap.
ALL_KEYS=(TELEGRAM_BOT_TOKEN DATABASE_URL SCRAPE_PROXY_URL SENTRY_DSN ADMIN_TELEGRAM_ID HEARTBEAT_URL)
KEYS=("${@:-${ALL_KEYS[@]}}")

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 1; }
[[ -r "$KUBECONFIG" ]] || { echo "kubeconfig not found: $KUBECONFIG" >&2; exit 1; }
kubectl get nodes >/dev/null 2>&1 || {
  echo "cluster unreachable — is the tunnel up? run ./deploy/tunnel.sh" >&2; exit 1
}
# Say out loud which cluster is about to receive the secrets.
echo "target: $(kubectl config current-context) ($KUBECONFIG)" >&2

declare -a PATCH_ENTRIES=()
for key in "${KEYS[@]}"; do
  printf '%s (leave empty to skip): ' "$key" >&2
  read -rs value; echo >&2
  [[ -z "$value" ]] && continue
  # jq builds the JSON so quotes/backslashes in a value can't break the payload.
  PATCH_ENTRIES+=("$(jq -n --arg k "$key" --arg v "$value" '{($k): $v}')")
  unset value
done

[[ ${#PATCH_ENTRIES[@]} -eq 0 ]] && { echo "nothing entered — no change"; exit 0; }

PATCH=$(printf '%s\n' "${PATCH_ENTRIES[@]}" | jq -s 'add | {stringData: .}')

if kubectl get secret "$SECRET" >/dev/null 2>&1; then
  printf '%s' "$PATCH" | kubectl patch secret "$SECRET" --patch-file /dev/stdin >/dev/null
  echo "updated secret/$SECRET"
else
  kubectl create secret generic "$SECRET" >/dev/null
  printf '%s' "$PATCH" | kubectl patch secret "$SECRET" --patch-file /dev/stdin >/dev/null
  echo "created secret/$SECRET"
fi

# Show which keys exist — names only, never values.
kubectl get secret "$SECRET" -o go-template='keys: {{range $k,$v := .data}}{{$k}} {{end}}{{"\n"}}'
echo "restart to pick them up:  kubectl rollout restart deployment/nexo-assist"
