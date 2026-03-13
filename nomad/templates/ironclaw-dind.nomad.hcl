# Parameterized job template for ironclaw-dind service type.
# Variables are substituted by the API's template renderer before submission.
#
# Required variables (substituted by renderer):
#   INSTANCE_NAME, IMAGE, MEM_MB, CPU_MHZ,
#   NEARAI_API_KEY, NEARAI_API_URL, SSH_PUBKEY, INSTANCE_TOKEN
#
# NOMAD_* variables are Nomad runtime variables resolved at job run time —
# the renderer MUST NOT substitute them.

job "agent-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "service"

  group "agent" {
    count = 1

    network {
      port "gateway" {}
      port "ssh" {}
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
        image   = "${IMAGE}"
        runtime = "sysbox-runc"
        ports   = ["gateway", "ssh"]

        port_map {
          gateway = 3000
          ssh     = 22
        }

        volumes = [
          "/data/crabshack/images/ironclaw-sandbox-worker.tar:/opt/.worker-image.tar:ro"
        ]
      }

      env {
        NEARAI_API_KEY = "${NEARAI_API_KEY}"
        NEARAI_API_URL = "${NEARAI_API_URL}"
        SSH_PUBKEY     = "${SSH_PUBKEY}"
        INSTANCE_TOKEN = "${INSTANCE_TOKEN}"
        INSTANCE_NAME  = "${INSTANCE_NAME}"
        GATEWAY_PORT   = "${NOMAD_PORT_gateway}"
        SSH_PORT       = "${NOMAD_PORT_ssh}"
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

      service {
        name = "agent-${INSTANCE_NAME}"
        port = "gateway"
        tags = ["agent", "ironclaw-dind", "instance:${INSTANCE_NAME}"]

        check {
          type     = "http"
          path     = "/health"
          port     = "gateway"
          interval = "15s"
          timeout  = "5s"
        }
      }

      service {
        name = "agent-${INSTANCE_NAME}-ssh"
        port = "ssh"
        tags = ["agent-ssh", "ironclaw-dind", "instance:${INSTANCE_NAME}"]

        check {
          type     = "tcp"
          port     = "ssh"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
