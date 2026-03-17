#!/usr/bin/env bash
# Validates that a Nomad + Docker + Sysbox cluster is healthy.
# Run after any bootstrap script to confirm
# all required services and capabilities are present.
set -euo pipefail

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
check "Nomad can reach Docker"    "nomad node status -self -json | grep -q '\"docker.version\"'"
check "Nomad allows sysbox-runc"  "nomad node status -self -json | grep -q sysbox-runc"

if [ "$FAIL" -eq 0 ]; then
  echo -e "\nAll checks passed."
else
  echo -e "\nSome checks failed."
  exit 1
fi
