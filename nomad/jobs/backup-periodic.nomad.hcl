# Periodic parameterized job: dispatched per-instance by the backup scheduler.
#
# Meta parameters (set at dispatch time):
#   INSTANCE_NAME, TARGET_NODE_ID, AGENT_ALLOC_ID
#
# Secrets and config are read from Nomad Variables:
#   crabshack/backup-config → S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, RESTIC_PASSWORD

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

      template {
        data        = <<-EOF
{{ with nomadVar "crabshack/backup-config" }}
RESTIC_PASSWORD={{ .RESTIC_PASSWORD }}
AWS_ACCESS_KEY_ID={{ .S3_ACCESS_KEY }}
AWS_SECRET_ACCESS_KEY={{ .S3_SECRET_KEY }}
RESTIC_REPOSITORY=s3:{{ .S3_ENDPOINT }}/{{ .S3_BUCKET }}/backups/{{ env "NOMAD_META_INSTANCE_NAME" }}
{{ end }}
BACKUP_PATH=/var/lib/nomad/alloc/{{ env "NOMAD_META_AGENT_ALLOC_ID" }}/agent/local
INSTANCE_NAME={{ env "NOMAD_META_INSTANCE_NAME" }}
EOF
        destination = "secrets/env.env"
        env         = true
      }

      resources {
        memory = 256
        cpu    = 200
      }
    }
  }
}
