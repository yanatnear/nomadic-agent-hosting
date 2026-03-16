job "promtail" {
  datacenters = ["dc1"]
  type        = "system"

  group "promtail" {
    network {
      port "http" { static = 9080 }
    }

    task "promtail" {
      driver = "docker"

      config {
        image = "grafana/promtail:2.9.4"
        ports = ["http"]
        args  = ["-config.file=/etc/promtail/promtail.yml"]
        volumes = [
          "local/promtail.yml:/etc/promtail/promtail.yml:ro",
          "/var/lib/nomad/alloc:/var/lib/nomad/alloc:ro",
        ]
      }

      resources {
        memory = 128
        cpu    = 100
      }

      service {
        name = "promtail"
        port = "http"
        tags = ["monitoring"]
      }
    }
  }
}
