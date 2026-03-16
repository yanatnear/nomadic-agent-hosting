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
