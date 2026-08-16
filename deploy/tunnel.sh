#!/usr/bin/env bash
# Open (or repair) the SSH tunnel that lets a local kubectl reach the cluster.
#
#   ./deploy/tunnel.sh          # ensure the tunnel is up
#   export KUBECONFIG=~/.kube/nexo.yaml && kubectl get pods
#
# Why a tunnel: the cluster API (6443) is deliberately NOT exposed to the internet — only SSH is.
# kubectl talks to 127.0.0.1:6443 here, ssh forwards that over the encrypted session to the API on
# the server. Deploys don't need this at all (CD runs on the server); it's for manual inspection.
#
# A dead tunnel is worse than none: the process keeps holding the local port while the connection
# underneath is gone, so kubectl hangs until "TLS handshake timeout" instead of failing fast.
# Hence: always kill an existing forward first, and keep ServerAlive* so ssh notices a drop itself.
set -euo pipefail

# Pin our kubeconfig explicitly: an inherited KUBECONFIG may point at a completely different
# cluster, and "it worked" against the wrong one is the worst possible outcome.
KUBECONFIG_FILE=${NEXO_KUBECONFIG:-$HOME/.kube/nexo.yaml}
HOST=${CD_HOST:-65.109.143.106}
USER_AT=${TUNNEL_USER:-root}
KEY=${SSH_KEY:-~/.ssh/nexo-assist}
PORT=6443

pkill -f "${PORT}:127.0.0.1:${PORT}" 2>/dev/null || true
sleep 1

ssh -i "$KEY" -fN \
  -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L "${PORT}:127.0.0.1:${PORT}" "${USER_AT}@${HOST}"

sleep 2
KUBECONFIG="$KUBECONFIG_FILE" kubectl get nodes
echo "tunnel up — for manual commands:  export KUBECONFIG=$KUBECONFIG_FILE"
