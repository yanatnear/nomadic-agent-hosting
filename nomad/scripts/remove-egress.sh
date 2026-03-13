#!/usr/bin/env bash
# Poststop hook: remove iptables egress filtering for an agent container.
# Usage: remove-egress.sh <alloc-id>
set -euo pipefail

ALLOC_ID="$1"
CHAIN="CRABSHACK-${ALLOC_ID:0:8}"

# Remove the FORWARD rule referencing our chain (may have multiple — remove all)
while iptables -D FORWARD -j "$CHAIN" 2>/dev/null; do :; done

# Flush and delete the chain
iptables -F "$CHAIN" 2>/dev/null || true
iptables -X "$CHAIN" 2>/dev/null || true

echo "Egress rules removed for alloc ${ALLOC_ID:0:8}"
