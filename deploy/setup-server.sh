#!/usr/bin/env bash
# Prepare a host to receive CD deploys: unprivileged deploy user, cluster access, repo
# checkout, the deploy script and a CD key restricted to running it. Also hardens SSH
# (no password login), installs fail2ban, and prints the host key for the CD_HOST_KEY secret.
#
# Run as root ON THE HOST, after k3s is installed (see docs/DEPLOY.md §4):
#   curl -fsSL https://raw.githubusercontent.com/Dmitry28/nexo-assist/main/deploy/setup-server.sh | bash
# or, from a checkout OUTSIDE $REPO_DIR:  sudo bash deploy/setup-server.sh
# TODO [M]: refuse when $0 resolves inside $REPO_DIR — step 3's force checkout rewrites the
# file bash is reading, which can half-configure a host mid-migration.
#
# Idempotent — safe to re-run; it installs whatever is pushed to $REPO_REF, so a local edit must
# be committed and pushed first. Prints the *path* of the CD private key (copy its contents into
# CD_SSH_KEY) and the host key value (→ CD_HOST_KEY); never the private key itself.
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/Dmitry28/nexo-assist.git}
REPO_DIR=${REPO_DIR:-/opt/nexo-assist}
CD_KEY=${CD_KEY:-/root/cd_key}
REPO_REF=${REPO_REF:-main}  # production ref this script installs deploy.sh from (CD then deploys a sha)

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
command -v k3s >/dev/null || { echo "k3s is not installed — see docs/DEPLOY.md §4.4" >&2; exit 1; }

# 1. Unprivileged user for deploys: no sudo, so a compromised CD key cannot take over the host.
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh /home/deploy/.kube

# 2. Cluster access: a private copy of the kubeconfig (k3s keeps the original root-only).
install -m 600 -o deploy -g deploy /etc/rancher/k3s/k3s.yaml /home/deploy/.kube/config

# 3. Repo checkout — deploys apply the manifests from git, so a deploy is reproducible.
#    One path for both cases: clone if absent, then always land on $REPO_REF. A bare `git clone`
#    checks out the remote's DEFAULT branch (`dev`, where we integrate), not the production ref,
#    so branching on clone-vs-refresh would silently give a fresh host a different deploy.sh
#    than a re-run.
#    NOTE: this leaves the checkout at the tip of $REPO_REF — not at whatever sha is running.
#    The next deploy re-syncs it; until then don't `apply -k` from here (see deploy.sh).
#    NOTE: don't run this script from inside $REPO_DIR — the checkout below rewrites the file
#    bash is reading. Use the `curl | bash` form or a copy outside the repo.
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
install -d -m 755 "$REPO_DIR"
chown -R deploy:deploy "$REPO_DIR"
# Run git as the owner — it refuses to touch another user's repo ("dubious ownership").
# runuser, not sudo: we are already root, and runuser ships with util-linux on every image.
[[ -d "$REPO_DIR/.git" ]] || runuser -u deploy -- git clone -q "$REPO_URL" "$REPO_DIR"
runuser -u deploy -- git -C "$REPO_DIR" fetch --quiet origin
runuser -u deploy -- git -C "$REPO_DIR" rev-parse --verify --quiet "origin/$REPO_REF" >/dev/null ||
  { echo "REPO_REF=$REPO_REF does not exist on origin" >&2; exit 1; }
runuser -u deploy -- git -C "$REPO_DIR" checkout --quiet --force "origin/$REPO_REF"

# 4. The deploy script itself, from that checkout (root-owned: the deploy user must not rewrite
#    it). Not from `dirname $0` — under the documented `curl | bash` there is no such path, and
#    the old fallback then installed a different version than the one just fetched, silently.
#    Consequence: a local edit reaches the host only after it is pushed to $REPO_REF.
install -m 755 -o root -g root "$REPO_DIR/deploy/deploy.sh" /usr/local/bin/deploy.sh

# 5. CD key, allowed to run exactly one command — no shell, no forwarding. Even if the key
#    leaks, it can only trigger a deploy.
#    The file is REWRITTEN, not appended to: the old check matched the key's *comment*, which
#    survives regeneration — so a rotated key was added while the replaced one stayed authorised,
#    i.e. rotation that changed nothing. `deploy` exists only for CD, so one line is all of it —
#    but that also means a key added here by hand is removed on the next run (announced below).
#    Rotating the CD key: rm /root/cd_key{,.pub} → re-run → copy the new key into CD_SSH_KEY.
#    CD_PUB is assigned first: a failing substitution inside printf would leave a
#    restrictions-only line and lock CD out entirely.
# A stale .pub with the private key gone makes ssh-keygen ask to overwrite — and under the
# documented `curl | bash` its stdin IS the script, so the answer would be the script's own text.
[[ -f "$CD_KEY" ]] || { rm -f "$CD_KEY.pub"; ssh-keygen -t ed25519 -N '' -C 'github-actions-cd' -f "$CD_KEY" -q </dev/null; }
# TODO [L]: AUTH is not overridable, so a test run with REPO_DIR/CD_KEY pointed elsewhere still
# rewrites the real deploy user's authorized_keys — it locked CD out once during testing.
AUTH=/home/deploy/.ssh/authorized_keys
RESTRICTIONS='command="/usr/local/bin/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding'
CD_PUB=$(cat "$CD_KEY.pub")
NEW_AUTH="$RESTRICTIONS $CD_PUB"
[[ -f "$AUTH" && "$(cat "$AUTH")" == "$NEW_AUTH" ]] ||
  echo "   note: deploy's authorized_keys reset to the CD key only"
printf '%s\n' "$NEW_AUTH" > "$AUTH"
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
# TODO [L]: drop once the current host is rebuilt — it only clears a manual edit predating this
# step.
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
# Printed here because this is the trusted moment — you are already on the box (why that matters:
# docs/DEPLOY.md §5b). Assigned first: a failing substitution inside `echo` does not trip `set -e`,
# and an empty value under this label is worse than no label at all.
HOST_KEY=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
echo "   put this into the GitHub secret CD_HOST_KEY (CI verifies the host against it):"
echo "     $HOST_KEY"
