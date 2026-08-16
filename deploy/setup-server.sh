#!/usr/bin/env bash
# Prepare a host to receive CD deploys: unprivileged deploy user, cluster access, repo
# checkout, the deploy script and a CD key restricted to running it. Also hardens SSH
# (no password login) and installs fail2ban.
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

# 6. SSH hardening. This box sees ~40k failed password attempts a week from untargeted
#    scanning, so the login path must not accept passwords at all — we only ever use keys.
#    NOTE: sshd takes the FIRST value it finds for a keyword, and cloud images ship their own
#    drop-in (e.g. 50-cloud-init.conf) that may re-enable passwords — hence the 01- prefix,
#    which sorts before them and therefore wins.
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/01-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
# TODO: drop once the current host is rebuilt — it only clears a manual edit predating this step.
rm -f /etc/ssh/sshd_config.d/99-hardening.conf
# Refuse to lock ourselves out: only apply a config sshd itself accepts.
sshd -t || { echo "sshd config invalid — 01-hardening.conf not applied" >&2; exit 1; }
systemctl reload ssh
# Verify by fact, not by the file existing: a base image whose sshd_config lacks the
# "Include /etc/ssh/sshd_config.d/*.conf" line ignores the drop-in entirely.
# NOTE: capture first, don't pipe into `grep -q`. Under `set -o pipefail` that combination
# reports failure even on a match: grep -q exits at the first hit, sshd -T dies writing to the
# closed pipe (SIGPIPE, 141), and pipefail surfaces the 141. Cost us a false "still on" alarm.
SSHD_EFFECTIVE=$(sshd -T) || { echo "sshd -T failed — cannot verify effective config" >&2; exit 1; }
if ! grep -qx 'passwordauthentication no' <<<"$SSHD_EFFECTIVE"; then
  echo "password auth still on — does /etc/ssh/sshd_config have 'Include /etc/ssh/sshd_config.d/*.conf'?" >&2
  exit 1
fi

# fail2ban bans repeat offenders. With passwords off, brute force cannot succeed anyway —
# this is log/CPU hygiene and cover for any other service we expose later.
# NOTE: our own drop-in, not jail.local — that file belongs to whoever runs the host, and
# rewriting it on every run would silently discard their jails.
# backend=systemd is explicit because recent Ubuntu ships no rsyslog: there is no
# /var/log/auth.log to read, and a log-file backend would leave the jail dead on arrival.
command -v fail2ban-server >/dev/null || { apt-get update -qq && apt-get install -y -qq fail2ban; }
install -d -m 755 /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/nexo-sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable -q --now fail2ban
systemctl restart fail2ban
# Poll: the socket isn't ready the instant systemctl returns, so a bare check races and false-fails.
for _ in $(seq 10); do fail2ban-client status sshd >/dev/null 2>&1 && break; sleep 1; done
fail2ban-client status sshd >/dev/null 2>&1 || { echo "fail2ban sshd jail is not active" >&2; exit 1; }

echo "✅ host ready for CD"
echo "   private key (put into the GitHub secret CD_SSH_KEY): $CD_KEY"
echo "   deploy user: deploy | repo: $REPO_DIR | script: /usr/local/bin/deploy.sh"
