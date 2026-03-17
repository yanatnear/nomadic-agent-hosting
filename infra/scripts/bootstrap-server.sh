#!/usr/bin/env bash
# Bootstrap a Nomad server node with Docker + Sysbox.
# Run as root or with sudo on Ubuntu 22.04+.
#
# Usage:
#   bash bootstrap-server.sh 10.0.0.1,10.0.0.2,10.0.0.3
#   ssh root@10.0.0.1 'bash -s' < bootstrap-server.sh 10.0.0.1,10.0.0.2,10.0.0.3
#
# The comma-separated argument is the list of server IPs for cluster join.
# bootstrap_expect is derived from the number of IPs provided.
set -euo pipefail

JOIN_IPS="${1:?Usage: bootstrap-server.sh <server_ip1,server_ip2,...>}"
IFS=',' read -ra SERVERS <<< "$JOIN_IPS"
BOOTSTRAP_EXPECT=${#SERVERS[@]}

NOMAD_VERSION="1.7.7"
SYSBOX_VERSION="0.6.6"
ARCH="$(dpkg --print-architecture)"

# ---------- Docker + Sysbox ----------

echo "=== Installing Docker CE ==="
if ! command -v docker &>/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
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

echo "=== Installing Sysbox CE ${SYSBOX_VERSION} ==="
if ! dpkg -l sysbox-ce &>/dev/null; then
  curl -fsSL -o /tmp/sysbox-ce.deb \
    "https://downloads.nestybox.com/sysbox/releases/v${SYSBOX_VERSION}/sysbox-ce_${SYSBOX_VERSION}-0.linux_amd64.deb"
  apt-get install -y /tmp/sysbox-ce.deb
  rm /tmp/sysbox-ce.deb
else
  echo "Sysbox already installed"
fi

# ---------- Nomad ----------

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
mkdir -p /opt/nomad/data /data/crabshack/images

echo "=== Writing Nomad server config ==="
mkdir -p /etc/nomad.d

# Build retry_join JSON array with :4648 port suffix
RETRY_JOIN="["
for i in "${!SERVERS[@]}"; do
  [[ $i -gt 0 ]] && RETRY_JOIN+=","
  RETRY_JOIN+="\"${SERVERS[$i]}:4648\""
done
RETRY_JOIN+="]"

cat > /etc/nomad.d/nomad.hcl <<EOF
datacenter = "dc1"
data_dir   = "/opt/nomad/data"

server {
  enabled          = true
  bootstrap_expect = ${BOOTSTRAP_EXPECT}

  server_join {
    retry_join = ${RETRY_JOIN}
  }
}
EOF

echo "=== Starting Nomad ==="
cat > /etc/systemd/system/nomad.service <<'UNIT'
[Unit]
Description=Nomad Agent
After=network.target

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
echo "=== Server bootstrap complete. ==="
