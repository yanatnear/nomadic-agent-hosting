#!/usr/bin/env bash
# Create GCP firewall rules for a CrabShack deployment.
#
# Usage:
#   bash infra/scripts/gcloud-firewall.sh <PROJECT_ID> [AGENT_PORT_RANGE]
#
# Arguments:
#   PROJECT_ID        (required)  GCP project ID
#   AGENT_PORT_RANGE  (optional)  Dynamic port range for agent containers (default: 19001-29999)
#
# Network tags applied to the VM determine which rules take effect:
#   http-server     — enables UI (3000), API (7700)
#   crabshack-node  — enables agent dynamic ports
#   ssh-server      — enables SSH (22)
#
# The Nomad UI (4646) is NOT exposed publicly. Access it via SSH tunnel:
#   gcloud compute ssh <INSTANCE> --zone=<ZONE> -- -L 4646:localhost:4646
#
set -euo pipefail

PROJECT="${1:?Usage: gcloud-firewall.sh <PROJECT_ID> [AGENT_PORT_RANGE]}"
AGENT_PORTS="${2:-19001-29999}"

log() { echo "=== $* ==="; }

create_if_missing() {
  local name="$1"; shift
  if gcloud compute firewall-rules describe "$name" --project="$PROJECT" &>/dev/null; then
    echo "EXISTS: $name"
  else
    gcloud compute firewall-rules create "$name" --project="$PROJECT" "$@"
    echo "CREATED: $name"
  fi
}

log "CrabShack API + UI (ports 3000, 7700)"
create_if_missing allow-crabshack-ports \
  --allow=tcp:3000,tcp:7700 \
  --target-tags=http-server \
  --source-ranges=0.0.0.0/0 \
  --description="CrabShack UI (3000) and API (7700) — both require authentication"

log "Agent dynamic ports (${AGENT_PORTS})"
create_if_missing crabshack-node-ports \
  --allow="tcp:${AGENT_PORTS}" \
  --target-tags=crabshack-node \
  --source-ranges=0.0.0.0/0 \
  --description="Nomad dynamic ports for agent gateway and SSH access"

log "SSH access"
create_if_missing allow-ssh \
  --allow=tcp:22 \
  --target-tags=ssh-server \
  --source-ranges=0.0.0.0/0 \
  --description="SSH access for administration"

echo ""
echo "Firewall rules configured. Required VM network tags:"
echo "  http-server     — UI + API"
echo "  crabshack-node  — agent dynamic ports"
echo "  ssh-server      — SSH"
echo ""
echo "Nomad UI (4646) is NOT exposed. Use SSH tunnel:"
echo "  gcloud compute ssh <INSTANCE> --zone=<ZONE> -- -L 4646:localhost:4646"
