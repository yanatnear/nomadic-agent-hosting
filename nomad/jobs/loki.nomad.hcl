job "loki" {
  datacenters = ["dc1"]
  type        = "service"

  group "loki" {
    count = 1

    network {
      port "http" { static = 3100 }
    }

    volume "loki-data" {
      type   = "host"
      source = "loki-data"
    }

    task "loki" {
      driver = "docker"

      config {
        image = "grafana/loki:2.9.4"
        ports = ["http"]
        args  = ["-config.file=/etc/loki/local-config.yaml"]
      }

      volume_mount {
        volume      = "loki-data"
        destination = "/loki"
      }

      resources {
        memory = 256
        cpu    = 250
      }

      service {
        name = "loki"
        port = "http"
        tags = ["monitoring"]

        check {
          type     = "http"
          path     = "/ready"
          port     = "http"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
