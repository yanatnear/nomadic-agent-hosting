#!/usr/bin/env bash
# Restores agent data from Restic snapshot.
# Required env: RESTIC_REPOSITORY, RESTIC_PASSWORD, RESTORE_PATH, INSTANCE_NAME
# Optional: SNAPSHOT_ID (defaults to "latest")
set -euo pipefail

SNAPSHOT="${SNAPSHOT_ID:-latest}"
restic restore "$SNAPSHOT" --target "$RESTORE_PATH"
echo "Restore complete for ${INSTANCE_NAME} (snapshot: ${SNAPSHOT})"
