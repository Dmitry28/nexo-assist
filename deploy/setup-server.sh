#!/usr/bin/env bash
# Prepare a host to receive CD deploys: unprivileged deploy user, cluster access, repo
# checkout, the deploy script and a CD key restricted to running it.
#
# Run as root ON THE HOST, after k3s is installed (see docs/DEPLOY.md §4):
#   curl -fsSL https://raw.githubusercontent.com/Dmitry28/nexo-assist/dev/deploy/setup-server.sh | bash
# or, from a checkout:  sudo bash deploy/setup-server.sh
#
# Idempotent — safe to re-run (e.g. after editing deploy/deploy.sh). Prints the CD public key
# and the path of the private key to copy into the GitHub secret; never prints the private key.
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/Dmitry28/nexo-assist.git}
REPO_DIR=${REPO_DIR:-/opt/nexo-assist}
CD_KEY=${CD_KEY:-/root/cd_key}

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
command -v k3s >/dev/null || { echo "k3s is not installed — see docs/DEPLOY.md §4.4" >&2; exit 1; }

# 1. Unprivileged user for deploys: no sudo, so a compromised CD key cannot take over the host.
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh /home/deploy/.kube

# 2. Cluster access: a private copy of the kubeconfig (k3s keeps the original root-only).
install -m 600 -o deploy -g deploy /etc/rancher/k3s/k3s.yaml /home/deploy/.kube/config

# 3. Repo checkout — the manifests deployed come from git, so a deploy is reproducible.
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
[[ -d "$REPO_DIR/.git" ]] || git clone -q "$REPO_URL" "$REPO_DIR"
chown -R deploy:deploy "$REPO_DIR"

# 4. The deploy script itself, from this repo (root-owned: the deploy user must not rewrite it).
install -m 755 -o root -g root "$(dirname "$0")/deploy.sh" /usr/local/bin/deploy.sh 2>/dev/null \
  || install -m 755 -o root -g root "$REPO_DIR/deploy/deploy.sh" /usr/local/bin/deploy.sh

# 5. CD key, allowed to run exactly one command — no shell, no forwarding. Even if the key
#    leaks, it can only trigger a deploy.
[[ -f "$CD_KEY" ]] || ssh-keygen -t ed25519 -N '' -C 'github-actions-cd' -f "$CD_KEY" -q
AUTH=/home/deploy/.ssh/authorized_keys
RESTRICTIONS='command="/usr/local/bin/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding'
grep -qF 'github-actions-cd' "$AUTH" 2>/dev/null || echo "$RESTRICTIONS $(cat "$CD_KEY.pub")" >> "$AUTH"
chown deploy:deploy "$AUTH"; chmod 600 "$AUTH"

echo "✅ host ready for CD"
echo "   private key (put into the GitHub secret CD_SSH_KEY): $CD_KEY"
echo "   deploy user: deploy | repo: $REPO_DIR | script: /usr/local/bin/deploy.sh"
