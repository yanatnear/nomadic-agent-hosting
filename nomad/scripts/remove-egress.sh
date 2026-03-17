#!/usr/bin/env bash
# Poststop hook: remove iptables egress filtering for an agent container.
# Usage: remove-egress.sh <alloc-id>
set -euo pipefail

ALLOC_ID="$1"
CHAIN="CRABSHACK-${ALLOC_ID:0:8}"
STATE_DIR="/var/run/crabshack-egress"
IP_FILE="${STATE_DIR}/${ALLOC_ID:0:8}.ip"

# Read the container IP recorded by apply-egress.sh for an exact FORWARD rule match
if [ -f "$IP_FILE" ]; then
  CONTAINER_IP=$(cat "$IP_FILE")
  # Remove the FORWARD rule with the exact source IP match
  while iptables -D FORWARD -s "$CONTAINER_IP" -j "$CHAIN" 2>/dev/null; do :; done
  rm -f "$IP_FILE"
else
  # Fallback: remove any FORWARD rule referencing our chain (less precise)
  while iptables -D FORWARD -j "$CHAIN" 2>/dev/null; do :; done
fi

# Flush and delete the chain
iptables -F "$CHAIN" 2>/dev/null || true
iptables -X "$CHAIN" 2>/dev/null || true

echo "Egress rules removed for alloc ${ALLOC_ID:0:8}"
