#!/usr/bin/env bash
# Backs up an agent's data directory to S3 via Restic.
# Required env: RESTIC_REPOSITORY, RESTIC_PASSWORD, BACKUP_PATH, INSTANCE_NAME
# Optional env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
set -euo pipefail

restic snapshots >/dev/null 2>&1 || restic init
restic backup "$BACKUP_PATH" --tag "instance:${INSTANCE_NAME}"
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
echo "Backup complete for ${INSTANCE_NAME}"
