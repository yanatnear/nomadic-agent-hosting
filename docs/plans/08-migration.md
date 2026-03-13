# Migration (Phased Cutover from v1)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from the v1 Docker Compose + SSH orchestrator to v2 Nomad-based orchestration with zero downtime for existing instances.

**Architecture:** Three-phase migration. Phase 1: new instances go to Nomad while existing ones stay on v1. Phase 2: migrate existing instances one at a time (backup → create on Nomad → restore). Phase 3: decommission v1 code.

**Tech Stack:** v1 API (existing), v2 API (from Plan 03), Nomad, Restic

**Depends on:** Plans 01-07 (all v2 components working)

---

## Phase 0: Preparation

### Task 1: Deploy Nomad/Consul alongside v1

- [ ] **Step 1: Install Nomad + Consul on all existing nodes**

Use the Ansible playbooks from Plan 01. Nomad/Consul agents coexist with the running v1 Docker Compose containers — they don't interfere.

```bash
ansible-playbook -i infra/ansible/inventory.yml infra/ansible/playbooks/bootstrap-client.yml
```

- [ ] **Step 2: Verify Nomad sees all nodes**

```bash
nomad node status
```

Expected: All nodes listed as `ready`.

- [ ] **Step 3: Deploy observability stack (Plan 06)**

```bash
nomad job run nomad/jobs/prometheus.nomad.hcl
nomad job run nomad/jobs/grafana.nomad.hcl
nomad job run nomad/jobs/loki.nomad.hcl
nomad job run nomad/jobs/promtail.nomad.hcl
nomad job run nomad/jobs/iptables-exporter.nomad.hcl
```

- [ ] **Step 4: Validate Sysbox works via Nomad on a test node**

```bash
# Run the test job from Plan 01, Task 8
nomad job run /tmp/test-sysbox.nomad
nomad alloc logs $(nomad job allocs -t '{{range .}}{{.ID}}{{end}}' test-sysbox)
nomad job stop -purge test-sysbox
```

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "milestone: Nomad cluster running alongside v1"
```

---

## Phase 1: New Instances on Nomad

### Task 2: Dual-mode API

- [ ] **Step 1: Add routing flag to v2 API**

The v2 thin API needs to handle both legacy (v1) and new (Nomad) instances during the transition. Add a `backend` field to the `instances` table:

```sql
ALTER TABLE instances ADD COLUMN backend TEXT NOT NULL DEFAULT 'nomad';
-- Legacy instances imported with backend = 'legacy'
```

- [ ] **Step 2: Import existing instance metadata**

Write a migration script that reads v1's SQLite database and inserts rows into v2's `instances` table with `backend = 'legacy'`:

```bash
# migration-import.ts
# Reads v1 crabshack.db, writes to v2 crabshack.db
# For each v1 instance: insert name, user_id, service_type, status, backend='legacy'
```

- [ ] **Step 3: Route requests based on backend**

- `GET /instances/:name` — if `backend = 'legacy'`, proxy to v1 API; if `backend = 'nomad'`, query Nomad
- `DELETE /instances/:name` — if legacy, proxy to v1; if Nomad, stop Nomad job
- `POST /instances` — always creates on Nomad (new instances)

- [ ] **Step 4: Deploy v2 API alongside v1**

Run v2 on a different port (e.g., 7701). Point the UI at v2. v2 proxies legacy requests to v1 on :7700.

- [ ] **Step 5: Smoke test**

- Create a new instance → should appear in Nomad
- List instances → should show both legacy and new
- Access a legacy instance → should still work (proxied to v1)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: dual-mode API routing legacy and Nomad instances"
```

---

### Task 3: Soak period

- [ ] **Step 1: Run in dual mode for 1-2 weeks**

Monitor:
- New Nomad instances: health checks, egress, backup/restore
- Legacy instances: still accessible, no degradation
- Nomad cluster: resource usage, scheduling latency

- [ ] **Step 2: Fix any issues discovered during soak**

---

## Phase 2: Migrate Existing Instances

### Task 4: Per-instance migration script

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-instance.sh`:

```bash
#!/usr/bin/env bash
# Migrates a single instance from v1 (Docker Compose) to v2 (Nomad).
# Usage: migrate-instance.sh <instance-name>
set -euo pipefail

INSTANCE_NAME="$1"
V1_API="http://localhost:7700"
V2_API="http://localhost:7701"
ADMIN_SECRET="${CRABSHACK_ADMIN_SECRET}"
AUTH="Authorization: Bearer ${ADMIN_SECRET}"

echo "=== 1. Backup instance on v1 ==="
curl -s -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/backup"
echo "Backup triggered. Waiting for completion..."
sleep 30  # or poll backup status

echo "=== 2. Get instance metadata from v1 ==="
META=$(curl -s -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}")
SERVICE_TYPE=$(echo "$META" | jq -r '.service_type')
MEM=$(echo "$META" | jq -r '.mem_limit // "4g"')
CPUS=$(echo "$META" | jq -r '.cpus // "1"')

echo "=== 3. Stop instance on v1 (but don't delete) ==="
curl -s -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/stop"

echo "=== 4. Create instance on v2 (Nomad) ==="
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "${V2_API}/instances" \
  -d "{
    \"name\": \"${INSTANCE_NAME}\",
    \"service_type\": \"${SERVICE_TYPE}\",
    \"mem_limit\": \"${MEM}\",
    \"cpus\": \"${CPUS}\"
  }"

echo "=== 5. Restore backup into new instance ==="
curl -s -X POST -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}/restore"

echo "=== 6. Verify health ==="
sleep 10
STATUS=$(curl -s -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}" | jq -r '.status')
if [ "$STATUS" = "running" ]; then
  echo "Migration successful! Instance ${INSTANCE_NAME} is running on Nomad."
  echo "=== 7. Update backend flag ==="
  # Mark as 'nomad' in the database
  curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
    "${V2_API}/instances/${INSTANCE_NAME}" \
    -d '{"backend": "nomad"}'
else
  echo "ERROR: Instance ${INSTANCE_NAME} status is '${STATUS}'. Rolling back..."
  # Rollback: stop Nomad instance, restart v1 instance
  curl -s -X DELETE -H "$AUTH" "${V2_API}/instances/${INSTANCE_NAME}"
  curl -s -X POST -H "$AUTH" "${V1_API}/instances/${INSTANCE_NAME}/start"
  exit 1
fi
```

- [ ] **Step 2: Test on a non-critical instance**

- [ ] **Step 3: Migrate remaining instances in batches**

Run the script for each instance. Monitor health after each migration. Rollback any failures.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-instance.sh
git commit -m "feat: per-instance migration script from v1 to v2"
```

---

## Phase 3: Decommission v1

### Task 5: Remove v1 infrastructure

- [ ] **Step 1: Verify all instances are on Nomad**

```bash
# No legacy instances should remain
curl -s -H "Authorization: Bearer ${SECRET}" http://localhost:7701/instances | \
  jq '[.[] | select(.backend == "legacy")] | length'
# Expected: 0
```

- [ ] **Step 2: Shut down v1 API server**

- [ ] **Step 3: Remove dual-mode routing from v2 API**

Delete the `backend` column and legacy proxy logic. The API now only talks to Nomad.

- [ ] **Step 4: Remove v1 Docker Compose containers from nodes**

```bash
# On each node, clean up old compose stacks
# Be careful — only remove compose projects that are confirmed migrated
```

- [ ] **Step 5: Remove v1 code from the repository (optional)**

Or archive it in a `v1-archive/` directory for reference.

- [ ] **Step 6: Switch v2 API to port 7700**

Update the config and any DNS/firewall rules.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "milestone: v1 decommissioned, v2 is the sole orchestrator"
```
