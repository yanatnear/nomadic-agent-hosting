job "iptables-exporter" {
  datacenters = ["dc1"]
  type        = "system"

  group "exporter" {
    network {
      port "metrics" {
        static = 9199
      }
    }

    service {
      name = "iptables-exporter"
      port = "metrics"
      tags = ["prometheus"]

      check {
        type     = "http"
        path     = "/"
        interval = "15s"
        timeout  = "3s"
      }
    }

    task "iptables-exporter" {
      driver = "raw_exec"

      config {
        command = "/usr/local/bin/iptables-exporter.sh"
        args    = ["9199"]
      }

      resources {
        cpu    = 50
        memory = 32
      }
    }
  }
}
