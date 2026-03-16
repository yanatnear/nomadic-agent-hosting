job "grafana" {
  datacenters = ["dc1"]
  type        = "service"

  group "grafana" {
    count = 1

    network {
      port "http" { static = 3001 }
    }

    volume "grafana-data" {
      type   = "host"
      source = "grafana-data"
    }

    task "grafana" {
      driver = "docker"

      config {
        image = "grafana/grafana:10.3.3"
        ports = ["http"]
        volumes = [
          "local/datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro",
        ]
      }

      volume_mount {
        volume      = "grafana-data"
        destination = "/var/lib/grafana"
      }

      env {
        GF_SECURITY_ADMIN_PASSWORD = "admin"
        GF_SERVER_HTTP_PORT        = "3001"
      }

      resources {
        memory = 256
        cpu    = 250
      }

      service {
        name = "grafana"
        port = "http"
        tags = ["monitoring"]

        check {
          type     = "http"
          path     = "/api/health"
          port     = "http"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
