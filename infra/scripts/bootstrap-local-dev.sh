#!/usr/bin/env bash
# Sets up a single-node Nomad + Consul dev cluster with Docker + Sysbox.
# Run as root or with sudo on Ubuntu 22.04+.
#
# After this script completes, run:
#   bash infra/scripts/validate-cluster.sh
set -euo pipefail

NOMAD_VERSION="1.7.7"
CONSUL_VERSION="1.18.2"
ARCH="$(dpkg --print-architecture)"  # amd64 or arm64

echo "=== Installing Consul ${CONSUL_VERSION} ==="
if ! command -v consul &>/dev/null; then
  curl -fsSL -o /tmp/consul.zip \
    "https://releases.hashicorp.com/consul/${CONSUL_VERSION}/consul_${CONSUL_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/consul.zip -d /usr/local/bin/
  rm /tmp/consul.zip
else
  echo "Consul already installed: $(consul version | head -1)"
fi

echo "=== Installing Nomad ${NOMAD_VERSION} ==="
if ! command -v nomad &>/dev/null; then
  curl -fsSL -o /tmp/nomad.zip \
    "https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/nomad.zip -d /usr/local/bin/
  rm /tmp/nomad.zip
else
  echo "Nomad already installed: $(nomad version | head -1)"
fi

echo "=== Creating data directories ==="
mkdir -p /opt/nomad/data /opt/consul/data /data/crabshack/images

echo "=== Writing Nomad dev config ==="
mkdir -p /etc/nomad.d
cat > /etc/nomad.d/nomad.hcl <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/nomad/data"

server {
  enabled          = true
  bootstrap_expect = 1
}

client {
  enabled = true
}

plugin "docker" {
  config {
    allow_runtimes = ["sysbox-runc", "runc"]
    volumes {
      enabled = true
    }
    pull_activity_timeout = "10m"
  }
}
EOF

echo "=== Writing Consul dev config ==="
mkdir -p /etc/consul.d
cat > /etc/consul.d/consul.hcl <<'EOF'
datacenter       = "dc1"
data_dir         = "/opt/consul/data"
server           = true
bootstrap_expect = 1
client_addr      = "0.0.0.0"
bind_addr        = "0.0.0.0"
ui_config {
  enabled = true
}
EOF

echo "=== Starting Consul ==="
if ! systemctl is-active --quiet consul 2>/dev/null; then
  cat > /etc/systemd/system/consul.service <<'UNIT'
[Unit]
Description=Consul Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/consul agent -config-dir=/etc/consul.d
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now consul
else
  echo "Consul already running; reloading config..."
  systemctl reload-or-restart consul
fi

echo "=== Starting Nomad ==="
if ! systemctl is-active --quiet nomad 2>/dev/null; then
  cat > /etc/systemd/system/nomad.service <<'UNIT'
[Unit]
Description=Nomad Agent
After=network.target consul.service

[Service]
ExecStart=/usr/local/bin/nomad agent -config=/etc/nomad.d
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now nomad
else
  echo "Nomad already running; reloading config..."
  systemctl reload-or-restart nomad
fi

echo "=== Waiting for Nomad to be ready (up to 30s) ==="
for i in $(seq 1 30); do
  if nomad agent-info >/dev/null 2>&1; then
    echo "Nomad is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Nomad did not become ready within 30 seconds."
    journalctl -u nomad --no-pager -n 20
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Done. Run infra/scripts/validate-cluster.sh to verify. ==="
