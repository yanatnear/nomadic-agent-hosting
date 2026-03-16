#!/usr/bin/env bash
# Migrates a single instance from v1 (Docker Compose) to v2 (Nomad).
# Usage: migrate-instance.sh <instance-name>
# Env: CRABSHACK_ADMIN_SECRET, V1_API (default http://localhost:7700), V2_API (default http://localhost:7701)
set -euo pipefail

INSTANCE_NAME="$1"
V1_API="${V1_API:-http://localhost:7700}"
V2_API="${V2_API:-http://localhost:7701}"
ADMIN_SECRET="${CRABSHACK_ADMIN_SECRET:?CRABSHACK_ADMIN_SECRET is required}"
AUTH="Authorization: Bearer ${ADMIN_SECRET}"

echo "=== Migrating ${INSTANCE_NAME} from v1 to v2 ==="

echo "=== 1. Backup instance on v1 ==="
curl -sf -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/backup" || {
  echo "ERROR: Failed to trigger backup on v1"
  exit 1
}
echo "Backup triggered. Waiting 30s for completion..."
sleep 30

echo "=== 2. Get instance metadata from v1 ==="
META=$(curl -sf -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}")
SERVICE_TYPE=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_type','ironclaw-dind'))")
MEM=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('mem_limit','4g'))")
CPUS=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('cpus','1'))")
IMAGE=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('image','ironclaw-dind:latest'))")

echo "  service_type=${SERVICE_TYPE} mem=${MEM} cpus=${CPUS} image=${IMAGE}"

echo "=== 3. Stop instance on v1 ==="
curl -sf -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/stop" || {
  echo "WARNING: Failed to stop v1 instance (may already be stopped)"
}

echo "=== 4. Create instance on v2 (Nomad) ==="
curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "${V2_API}/instances" \
  -d "{
    \"name\": \"${INSTANCE_NAME}\",
    \"service_type\": \"${SERVICE_TYPE}\",
    \"mem_limit\": \"${MEM}\",
    \"cpus\": \"${CPUS}\",
    \"image\": \"${IMAGE}\",
    \"nearai_api_key\": \"migrated\",
    \"nearai_api_url\": \"https://api.near.ai\"
  }" || {
  echo "ERROR: Failed to create instance on v2. Rolling back..."
  curl -sf -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/start" || true
  exit 1
}

echo "=== 5. Restore backup into new instance ==="
curl -sf -X POST -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}/restore" || {
  echo "ERROR: Failed to restore backup. Rolling back..."
  curl -sf -X DELETE -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}" || true
  curl -sf -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/start" || true
  exit 1
}

echo "=== 6. Verify health ==="
sleep 10
STATUS=$(curl -sf -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','unknown'))")
if [ "$STATUS" = "running" ]; then
  echo "Migration successful! ${INSTANCE_NAME} is running on Nomad."
else
  echo "ERROR: Instance status is '${STATUS}'. Rolling back..."
  curl -sf -X DELETE -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}" || true
  curl -sf -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/start" || true
  exit 1
fi
