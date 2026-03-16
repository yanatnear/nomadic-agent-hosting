job "prometheus" {
  datacenters = ["dc1"]
  type        = "service"

  group "prometheus" {
    count = 1

    network {
      port "http" { static = 9090 }
    }

    volume "prometheus-data" {
      type   = "host"
      source = "prometheus-data"
    }

    task "prometheus" {
      driver = "docker"

      config {
        image = "prom/prometheus:v2.50.1"
        ports = ["http"]
        args  = [
          "--config.file=/etc/prometheus/prometheus.yml",
          "--storage.tsdb.path=/prometheus",
          "--storage.tsdb.retention.time=30d",
        ]
        volumes = [
          "local/prometheus.yml:/etc/prometheus/prometheus.yml:ro",
          "local/alerts:/etc/prometheus/alerts:ro",
        ]
      }

      volume_mount {
        volume      = "prometheus-data"
        destination = "/prometheus"
      }

      template {
        source      = "local/prometheus.yml"
        destination = "local/prometheus.yml"
      }

      resources {
        memory = 512
        cpu    = 500
      }

      service {
        name = "prometheus"
        port = "http"
        tags = ["monitoring"]

        check {
          type     = "http"
          path     = "/-/healthy"
          port     = "http"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
