# Parameterized job template for openclaw service type.
# Single container with built-in gateway + SSH. No Sysbox, no worker tarball.
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
      port "ssh" { to = 22 }
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

    # --- Main agent container ---

    task "agent" {
      driver = "docker"

      config {
        image = "${IMAGE}"
        ports = ["gateway", "ssh"]

        labels {
          crabshack_instance = "${INSTANCE_NAME}"
          crabshack_task     = "agent"
        }
      }

      template {
        data        = <<-EOF
{{ with nomadVar "crabshack/${INSTANCE_NAME}" }}
NEARAI_API_KEY={{ .NEARAI_API_KEY }}
INSTANCE_TOKEN={{ .INSTANCE_TOKEN }}
{{ end }}
NEARAI_API_URL=${NEARAI_API_URL}
SSH_PUBKEY=${SSH_PUBKEY}
INSTANCE_NAME=${INSTANCE_NAME}
GATEWAY_PORT={{ env "NOMAD_PORT_gateway" }}
SSH_PORT={{ env "NOMAD_PORT_ssh" }}
EOF
        destination = "secrets/env.env"
        env         = true
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }
    }
  }
}
