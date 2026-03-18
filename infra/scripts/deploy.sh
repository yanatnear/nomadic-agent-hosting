#!/usr/bin/env bash
# Single-node deploy: takes a fresh Ubuntu 22.04+ GCloud VM to a fully working
# agent-hosting-v2 instance with Nomad (server+client), Docker+Sysbox, and CrabShack API.
#
# Usage:
#   sudo bash infra/scripts/deploy.sh <ADMIN_SECRET> [APP_DIR] [PORT]
#
# Arguments:
#   ADMIN_SECRET  (required)  CRABSHACK_ADMIN_SECRET value
#   APP_DIR       (optional)  Path to agent-hosting-v2 repo (default: /home/$SUDO_USER/agent-hosting-v2)
#   PORT          (optional)  API listen port (default: 7700)
#
# Idempotent — safe to re-run.
set -euo pipefail

ADMIN_SECRET="${1:?Usage: deploy.sh <ADMIN_SECRET> [APP_DIR] [PORT]}"
APP_DIR="${2:-/home/${SUDO_USER:-$USER}/agent-hosting-v2}"
PORT="${3:-7700}"

NOMAD_VERSION="1.7.7"
SYSBOX_VERSION="0.6.6"
ARCH="$(dpkg --print-architecture)"

# ------------------------------------------------------------------ helpers ---

log() { echo "=== $* ==="; }

wait_for_nomad() {
  log "Waiting for Nomad to be ready (up to 30s)"
  for i in $(seq 1 30); do
    if nomad agent-info >/dev/null 2>&1; then
      echo "Nomad is ready."
      return 0
    fi
    [ "$i" -eq 30 ] && {
      echo "ERROR: Nomad did not become ready within 30 seconds."
      journalctl -u nomad --no-pager -n 20
      exit 1
    }
    sleep 1
  done
}

# Detect internal IP (first non-loopback)
INTERNAL_IP="$(hostname -I | awk '{print $1}')"

# Detect public IP via GCloud metadata, fall back to internal
PUBLIC_IP="$(curl -sf -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' \
  2>/dev/null || echo "$INTERNAL_IP")"

# Detect primary network interface
NET_IFACE="$(ip -o -4 route show to default | awk '{print $5}' | head -1)"

echo "Internal IP: ${INTERNAL_IP}"
echo "Public IP:   ${PUBLIC_IP}"
echo "Interface:   ${NET_IFACE}"
echo "App dir:     ${APP_DIR}"
echo "API port:    ${PORT}"
echo ""

# --------------------------------------------------------------- 1. Docker ---

log "Installing Docker CE"
if ! command -v docker &>/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg unzip
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  echo "Docker already installed: $(docker --version)"
fi

# -------------------------------------------------------------- 2. Sysbox ---

log "Installing Sysbox CE ${SYSBOX_VERSION}"
if ! dpkg -l sysbox-ce &>/dev/null; then
  curl -fsSL -o /tmp/sysbox-ce.deb \
    "https://downloads.nestybox.com/sysbox/releases/v${SYSBOX_VERSION}/sysbox-ce_${SYSBOX_VERSION}-0.linux_amd64.deb"
  apt-get install -y /tmp/sysbox-ce.deb
  rm /tmp/sysbox-ce.deb
else
  echo "Sysbox already installed"
fi

# ---------------------------------------------------- 3. Configure Docker ---

log "Configuring Docker daemon (log rotation + sysbox-runc)"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "runtimes": {
    "sysbox-runc": {
      "path": "/usr/bin/sysbox-runc"
    }
  }
}
EOF
systemctl restart docker

# --------------------------------------------------------------- 4. Nomad ---

log "Installing Nomad ${NOMAD_VERSION}"
if ! command -v nomad &>/dev/null; then
  curl -fsSL -o /tmp/nomad.zip \
    "https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/nomad.zip -d /usr/local/bin/
  rm /tmp/nomad.zip
else
  echo "Nomad already installed: $(nomad version | head -1)"
fi

log "Writing Nomad config"
mkdir -p /etc/nomad.d
cat > /etc/nomad.d/nomad.hcl <<EOF
datacenter = "dc1"
data_dir   = "/opt/nomad/data"

bind_addr = "0.0.0.0"

addresses {
  http = "${INTERNAL_IP}"
  rpc  = "${INTERNAL_IP}"
  serf = "${INTERNAL_IP}"
}

advertise {
  http = "${INTERNAL_IP}"
  rpc  = "${INTERNAL_IP}"
  serf = "${INTERNAL_IP}"
}

server {
  enabled          = true
  bootstrap_expect = 1
}

client {
  enabled = true
  network_interface = "${NET_IFACE}"

  meta {
    "public_ip" = "${PUBLIC_IP}"
  }

  host_volume "agent-data" {
    path      = "/data/crabshack/agent-data"
    read_only = false
  }
}

plugin "docker" {
  config {
    allow_runtimes = ["runc", "sysbox-runc"]
    volumes {
      enabled = true
    }
    pull_activity_timeout = "10m"
  }
}

plugin "raw_exec" {
  config {
    enabled = true
  }
}
EOF

log "Installing Nomad systemd unit"
cat > /etc/systemd/system/nomad.service <<'UNIT'
[Unit]
Description=Nomad Agent
After=network.target docker.service
Wants=docker.service

[Service]
ExecStart=/usr/local/bin/nomad agent -config=/etc/nomad.d
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nomad
systemctl restart nomad

# ----------------------------------------------------------------- 5. Bun ---

log "Installing Bun"
if ! command -v bun &>/dev/null; then
  # Install as the non-root user if available, otherwise root
  if [ -n "${SUDO_USER:-}" ]; then
    sudo -u "$SUDO_USER" bash -c 'curl -fsSL https://bun.sh/install | bash'
    BUN_BIN="/home/${SUDO_USER}/.bun/bin/bun"
  else
    curl -fsSL https://bun.sh/install | bash
    BUN_BIN="${HOME}/.bun/bin/bun"
  fi
  # Make bun available system-wide
  ln -sf "$BUN_BIN" /usr/local/bin/bun
else
  echo "Bun already installed: $(bun --version)"
fi

# ------------------------------------------------- 6. Data directories ---

log "Creating data directories"
mkdir -p /opt/nomad/data /data/crabshack/images /data/crabshack/agent-data

# -------------------------------------------------- 7. Egress scripts ---

log "Deploying egress scripts"
cp "${APP_DIR}/nomad/scripts/apply-egress.sh" /usr/local/bin/apply-egress.sh
cp "${APP_DIR}/nomad/scripts/remove-egress.sh" /usr/local/bin/remove-egress.sh
chmod +x /usr/local/bin/apply-egress.sh /usr/local/bin/remove-egress.sh

# ---------------------------------------------------- 8. App dependencies ---

log "Installing app dependencies"
cd "$APP_DIR"
bun install
cd "$APP_DIR/ui"
bun install
cd "$APP_DIR"

# ----------------------------------------- 9. CrabShack API systemd unit ---

log "Creating CrabShack API systemd unit"
cat > /etc/systemd/system/crabshack-api.service <<EOF
[Unit]
Description=CrabShack API Server
After=network.target nomad.service
Wants=nomad.service

[Service]
Type=simple
User=${SUDO_USER:-root}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/local/bin/bun src/main.ts
Restart=on-failure
RestartSec=5

Environment=CRABSHACK_ADMIN_SECRET=${ADMIN_SECRET}
Environment=CRABSHACK_PORT=${PORT}
Environment=CRABSHACK_DATA_DIR=/data/crabshack
Environment=NOMAD_ADDR=http://${INTERNAL_IP}:4646
Environment=NODE_SSH_HOST=${PUBLIC_IP}
Environment=NODE_SSH_PORT=22
Environment=NODE_SSH_USER=${SUDO_USER:-root}

[Install]
WantedBy=multi-user.target
EOF
log "Creating CrabShack UI systemd unit"
cat > /etc/systemd/system/crabshack-ui.service <<EOF
[Unit]
Description=CrabShack UI Server
After=network.target crabshack-api.service
Wants=crabshack-api.service

[Service]
Type=simple
User=${SUDO_USER:-root}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/local/bin/bun ui/src/ui-server.ts
Restart=on-failure
RestartSec=5

Environment=CRABSHACK_ADMIN_SECRET=${ADMIN_SECRET}
Environment=CRABSHACK_UI_PORT=3000
Environment=CRABSHACK_API_URL=http://localhost:${PORT}

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

# ------------------------------------------------------ 10. Start services ---

wait_for_nomad

log "Starting CrabShack API"
systemctl enable --now crabshack-api

log "Starting CrabShack UI"
systemctl enable --now crabshack-ui

# ----------------------------------------------------------- 11. Validate ---

log "Validating deployment"
sleep 2

FAIL=0
check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "OK: $name"
  else
    echo "FAIL: $name"
    FAIL=1
  fi
}

check "Nomad agent is running"    "nomad agent-info"
check "Docker daemon is running"  "docker info"
check "Sysbox runtime available"  "docker info --format '{{.Runtimes}}' | grep -q sysbox-runc"
check "Nomad sees Docker"         "nomad node status -self -json | grep -q '\"docker.version\"'"
check "Nomad allows sysbox-runc"  "nomad node status -self -json | grep -q sysbox-runc"
check "CrabShack API health"      "curl -sf http://localhost:${PORT}/health"
check "CrabShack UI reachable"   "curl -sf -o /dev/null http://localhost:3000/login"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "All checks passed. Deployment complete."
  echo ""
  echo "  Nomad UI:       http://${PUBLIC_IP}:4646"
  echo "  CrabShack API:  http://${PUBLIC_IP}:${PORT}"
  echo "  CrabShack UI:   http://${PUBLIC_IP}:3000"
  echo "  Health check:   curl http://${PUBLIC_IP}:${PORT}/health"
else
  echo ""
  echo "Some checks failed. Review output above."
  exit 1
fi
