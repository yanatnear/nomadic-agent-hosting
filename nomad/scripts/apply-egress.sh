#!/usr/bin/env bash
# Poststart hook: apply iptables egress filtering for an agent container.
# Usage: apply-egress.sh <alloc-id>
# Finds the container IP from Docker and applies DROP-all + allow-list rules.
set -euo pipefail

ALLOC_ID="$1"

# Find the Docker container ID for this allocation.
# Nomad labels containers with the allocation ID.
CONTAINER_ID=$(docker ps --filter "label=com.hashicorp.nomad.alloc_id=${ALLOC_ID}" --format '{{.ID}}' | head -1)
if [ -z "$CONTAINER_ID" ]; then
  echo "ERROR: No container found for alloc ${ALLOC_ID}" >&2
  exit 1
fi

# Get the container's IP address
CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER_ID")
if [ -z "$CONTAINER_IP" ]; then
  echo "ERROR: No IP found for container ${CONTAINER_ID}" >&2
  exit 1
fi

CHAIN="CRABSHACK-${ALLOC_ID:0:8}"

# Create a dedicated iptables chain for this container
iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

# Allow established connections (responses to outbound requests)
iptables -A "$CHAIN" -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (UDP 53)
iptables -A "$CHAIN" -p udp --dport 53 -j ACCEPT

# Allow HTTPS (TCP 443) — needed for API calls
iptables -A "$CHAIN" -p tcp --dport 443 -j ACCEPT

# Allow HTTP (TCP 80) — needed for package managers
iptables -A "$CHAIN" -p tcp --dport 80 -j ACCEPT

# Drop everything else from this container
iptables -A "$CHAIN" -j DROP

# Insert the chain into FORWARD for traffic from this container
iptables -I FORWARD -s "$CONTAINER_IP" -j "$CHAIN"

echo "Egress rules applied for ${CONTAINER_IP} (alloc ${ALLOC_ID:0:8})"
