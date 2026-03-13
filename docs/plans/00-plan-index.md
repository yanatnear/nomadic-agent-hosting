# Agent Hosting v2 — Implementation Plans

Based on [AGENT-HOSTING-INFRA-DESIGN.md](../../AGENT-HOSTING-INFRA-DESIGN.md).

## Plans (in dependency order)

| # | Plan | Depends on | Status |
|---|------|-----------|--------|
| 01 | Nomad + Consul cluster setup | — | Pending |
| 02 | Nomad job templates (3 service types + Sysbox) | 01 | Pending |
| 03 | Thin API (Bun.js → Nomad) | 02 | Pending |
| 04 | Egress hooks (poststart/poststop + exporter) | 02 | Pending |
| 05 | Backups (Restic + Nomad batch jobs) | 03 | Pending |
| 06 | Observability (Prometheus + Grafana + Loki) | 01 | Pending |
| 07 | Ingress + UI (Cloudflare, subdomain routing, portal) | 03 | Pending |
| 08 | Migration (phased cutover from v1) | 03, 04, 05 | Pending |
