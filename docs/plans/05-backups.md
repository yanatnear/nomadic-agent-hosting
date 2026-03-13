# Backups (Restic + Nomad Batch Jobs)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace custom S3 backup/restore code with Restic, triggered as Nomad batch/periodic jobs.

**Architecture:** Each instance gets a Restic repo in S3 (keyed by instance name). Backup runs as a Nomad batch job that mounts the agent's data volume and runs `restic backup`. Restore is another batch job. A periodic job runs daily backups for all active instances. The thin API dispatches these jobs and reports status.

**Tech Stack:** Restic, Nomad batch/periodic jobs, S3-compatible storage

**Depends on:** Plan 03 (thin API for dispatching jobs)

---

## File Structure

```
agent-hosting-v2/
  nomad/
    templates/
      backup.nomad.hcl             # Batch job: backup one instance
      restore.nomad.hcl            # Batch job: restore one instance
    jobs/
      backup-periodic.nomad.hcl    # Periodic job: nightly backup of all instances
    scripts/
      restic-backup.sh             # Wrapper: init repo if needed, run backup
      restic-restore.sh            # Wrapper: restore snapshot
  src/
    routes/
      backup-routes.ts             # API routes for trigger backup/restore
```

---

### Task 1: Restic backup wrapper script

**Files:**
- Create: `nomad/scripts/restic-backup.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Backs up an agent's data directory to S3 via Restic.
# Env vars: RESTIC_REPOSITORY, RESTIC_PASSWORD, BACKUP_PATH
set -euo pipefail

# Initialize repo if it doesn't exist
restic snapshots >/dev/null 2>&1 || restic init

# Run backup
restic backup "$BACKUP_PATH" --tag "instance:${INSTANCE_NAME}"

# Apply retention policy
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune

echo "Backup complete for ${INSTANCE_NAME}"
```

- [ ] **Step 2: Commit**

```bash
git add nomad/scripts/restic-backup.sh
git commit -m "feat: restic backup wrapper script"
```

---

### Task 2: Restic restore wrapper script

**Files:**
- Create: `nomad/scripts/restic-restore.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Restores an agent's data from the latest Restic snapshot.
# Env vars: RESTIC_REPOSITORY, RESTIC_PASSWORD, RESTORE_PATH
# Optional: SNAPSHOT_ID (defaults to "latest")
set -euo pipefail

SNAPSHOT="${SNAPSHOT_ID:-latest}"

restic restore "$SNAPSHOT" --target "$RESTORE_PATH"

echo "Restore complete for ${INSTANCE_NAME} (snapshot: ${SNAPSHOT})"
```

- [ ] **Step 2: Commit**

```bash
git add nomad/scripts/restic-restore.sh
git commit -m "feat: restic restore wrapper script"
```

---

### Task 3: Nomad batch job template for backup

**Files:**
- Create: `nomad/templates/backup.nomad.hcl`

- [ ] **Step 1: Write the template**

```hcl
job "backup-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "batch"

  # Schedule on the same node as the running agent
  constraint {
    attribute = "${node.unique.id}"
    value     = "${TARGET_NODE_ID}"
  }

  group "backup" {
    task "restic" {
      driver = "raw_exec"

      config {
        command = "/usr/local/bin/restic-backup.sh"
      }

      env {
        RESTIC_REPOSITORY = "s3:${S3_ENDPOINT}/${S3_BUCKET}/backups/${INSTANCE_NAME}"
        RESTIC_PASSWORD   = "${RESTIC_PASSWORD}"
        BACKUP_PATH       = "/var/lib/nomad/alloc/${AGENT_ALLOC_ID}/agent/local"
        INSTANCE_NAME     = "${INSTANCE_NAME}"
        AWS_ACCESS_KEY_ID     = "${S3_ACCESS_KEY}"
        AWS_SECRET_ACCESS_KEY = "${S3_SECRET_KEY}"
      }

      resources {
        memory = 256
        cpu    = 200
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add nomad/templates/backup.nomad.hcl
git commit -m "feat: Nomad batch job template for Restic backup"
```

---

### Task 4: Nomad batch job template for restore

**Files:**
- Create: `nomad/templates/restore.nomad.hcl`

- [ ] **Step 1: Write the template (similar to backup but runs restic-restore.sh)**

- [ ] **Step 2: Commit**

```bash
git add nomad/templates/restore.nomad.hcl
git commit -m "feat: Nomad batch job template for Restic restore"
```

---

### Task 5: Periodic backup job

**Files:**
- Create: `nomad/jobs/backup-periodic.nomad.hcl`

- [ ] **Step 1: Write periodic job**

This is a parameterized job that the API dispatches for each active instance nightly, or can be run on-demand.

```hcl
job "backup-all" {
  datacenters = ["dc1"]
  type        = "batch"

  periodic {
    cron             = "0 3 * * *"
    prohibit_overlap = true
    time_zone        = "UTC"
  }

  parameterized {
    meta_required = ["INSTANCE_NAME", "TARGET_NODE_ID", "AGENT_ALLOC_ID"]
  }

  group "backup" {
    task "restic" {
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/restic-backup.sh"
      }
      env {
        RESTIC_REPOSITORY = "s3:${S3_ENDPOINT}/${S3_BUCKET}/backups/${NOMAD_META_INSTANCE_NAME}"
        RESTIC_PASSWORD   = "${RESTIC_PASSWORD}"
        BACKUP_PATH       = "/var/lib/nomad/alloc/${NOMAD_META_AGENT_ALLOC_ID}/agent/local"
        INSTANCE_NAME     = "${NOMAD_META_INSTANCE_NAME}"
      }
      resources {
        memory = 256
        cpu    = 200
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add nomad/jobs/backup-periodic.nomad.hcl
git commit -m "feat: periodic Nomad job for nightly backups"
```

---

### Task 6: Backup API routes

**Files:**
- Create: `src/routes/backup-routes.ts`

- [ ] **Step 1: Write route handlers**

- `POST /instances/:name/backup` — look up instance's Nomad alloc, dispatch backup batch job, return job ID
- `POST /instances/:name/restore` — stop agent, dispatch restore batch job, restart agent
- `GET /instances/:name/backups` — query Restic snapshots (via Nomad dispatch of `restic snapshots --json`)

- [ ] **Step 2: Commit**

```bash
git add src/routes/backup-routes.ts
git commit -m "feat: backup API routes dispatching Nomad batch jobs"
```

---

### Task 7: End-to-end backup/restore test

- [ ] **Step 1: Create a test instance, write data into it**
- [ ] **Step 2: Trigger backup via API**
- [ ] **Step 3: Delete the data**
- [ ] **Step 4: Trigger restore via API**
- [ ] **Step 5: Verify data is restored**
- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "test: validated backup/restore end-to-end with Restic"
```
