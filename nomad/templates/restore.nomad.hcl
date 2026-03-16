# Parameterized batch job template for one-shot agent restore.
# Variables substituted by the API's template renderer before submission.
#
# Required variables (substituted by renderer):
#   INSTANCE_NAME, TARGET_NODE_ID,
#   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
#   RESTIC_PASSWORD, RESTORE_PATH
#
# Optional variables:
#   SNAPSHOT_ID (defaults to "latest" in the script if unset)

job "restore-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "batch"

  constraint {
    attribute = "${node.unique.id}"
    value     = "${TARGET_NODE_ID}"
  }

  group "restore" {
    count = 1

    task "restic" {
      driver = "raw_exec"

      config {
        command = "/usr/local/bin/restic-restore.sh"
      }

      env {
        RESTIC_REPOSITORY      = "s3:${S3_ENDPOINT}/${S3_BUCKET}/backups/${INSTANCE_NAME}"
        RESTIC_PASSWORD        = "${RESTIC_PASSWORD}"
        RESTORE_PATH           = "${RESTORE_PATH}"
        INSTANCE_NAME          = "${INSTANCE_NAME}"
        SNAPSHOT_ID            = "${SNAPSHOT_ID}"
        AWS_ACCESS_KEY_ID      = "${S3_ACCESS_KEY}"
        AWS_SECRET_ACCESS_KEY  = "${S3_SECRET_KEY}"
      }

      resources {
        memory = 256
        cpu    = 200
      }
    }
  }
}
