# Parameterized job template for ironclaw service type.
# Two tasks in one group: worker container + openssh sidecar sharing a host volume.
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

    volume "agent-data" {
      type   = "host"
      source = "agent-data"
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

        port_map {
          gateway = 3000
        }
      }

      volume_mount {
        volume      = "agent-data"
        destination = "/home/agent"
      }

      env {
        NEARAI_API_KEY = "${NEARAI_API_KEY}"
        NEARAI_API_URL = "${NEARAI_API_URL}"
        INSTANCE_TOKEN = "${INSTANCE_TOKEN}"
        INSTANCE_NAME  = "${INSTANCE_NAME}"
        GATEWAY_PORT   = "${NOMAD_PORT_gateway}"
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

      service {
        name = "agent-${INSTANCE_NAME}"
        port = "gateway"
        tags = ["agent", "ironclaw", "instance:${INSTANCE_NAME}"]

        check {
          type     = "http"
          path     = "/health"
          port     = "gateway"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }

    # --- SSH sidecar ---

    task "sshd" {
      driver = "docker"

      config {
        image = "lscr.io/linuxserver/openssh-server:latest"
        ports = ["ssh"]

        port_map {
          ssh = 2222
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

      service {
        name = "agent-${INSTANCE_NAME}-ssh"
        port = "ssh"
        tags = ["agent-ssh", "ironclaw", "instance:${INSTANCE_NAME}"]

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
