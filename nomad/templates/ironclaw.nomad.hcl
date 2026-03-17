# Parameterized job template for ironclaw service type.
# Two tasks in one group: worker container + openssh sidecar sharing a host volume.
# Variables are substituted by the API's template renderer before submission.
#
# Required variables (substituted by renderer):
#   INSTANCE_NAME, IMAGE, MEM_MB, CPU_MHZ,
#   NEARAI_API_URL, SSH_PUBKEY
#
# Secrets (NEARAI_API_KEY, INSTANCE_TOKEN) are stored in Nomad Variables
# at path "crabshack/<instance-name>" and injected via template blocks.
#
# NOMAD_* variables are Nomad runtime variables resolved at job run time —
# the renderer MUST NOT substitute them.

job "agent-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "service"

  group "agent" {
    count = 1

    network {
      port "gateway" { to = 3000 }
      port "ssh" { to = 2222 }
    }

    volume "agent-data" {
      type   = "host"
      source = "agent-data"
    }

    # --- Clean stale PID file from shared volume before worker starts ---

    task "pid-cleanup" {
      lifecycle {
        hook    = "prestart"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/bin/sh"
        args    = ["-c", "rm -f /data/crabshack/agent-data/.ironclaw/ironclaw.pid"]
      }
      resources {
        memory = 16
        cpu    = 50
      }
    }

    # --- Egress lifecycle hooks ---

    task "egress-setup" {
      lifecycle {
        hook    = "poststart"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/apply-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "egress-cleanup" {
      lifecycle {
        hook    = "poststop"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/remove-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    # --- Worker container ---

    task "worker" {
      driver = "docker"

      config {
        image = "${IMAGE}"
        ports = ["gateway"]

        labels {
          crabshack_instance = "${INSTANCE_NAME}"
          crabshack_task     = "worker"
        }
      }

      volume_mount {
        volume      = "agent-data"
        destination = "/home/agent"
      }

      template {
        data        = <<-EOF
{{ with nomadVar "crabshack/${INSTANCE_NAME}" }}
NEARAI_API_KEY={{ .NEARAI_API_KEY }}
INSTANCE_TOKEN={{ .INSTANCE_TOKEN }}
{{ end }}
NEARAI_API_URL=${NEARAI_API_URL}
INSTANCE_NAME=${INSTANCE_NAME}
GATEWAY_PORT={{ env "NOMAD_PORT_gateway" }}
EOF
        destination = "secrets/env.env"
        env         = true
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

    }

    # --- SSH sidecar ---

    task "sshd" {
      driver = "docker"

      config {
        image = "lscr.io/linuxserver/openssh-server:latest"
        ports = ["ssh"]

        labels {
          crabshack_instance = "${INSTANCE_NAME}"
          crabshack_task     = "sshd"
        }
      }

      volume_mount {
        volume      = "agent-data"
        destination = "/home/agent"
      }

      env {
        PUBLIC_KEY  = "${SSH_PUBKEY}"
        USER_NAME   = "agent"
        SUDO_ACCESS = "true"
      }

      resources {
        memory = 128
        cpu    = 100
      }
    }
  }
}
