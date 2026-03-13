# Observability (Prometheus + Grafana + Loki)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a Prometheus + Grafana + Loki observability stack on the Nomad cluster, replacing custom metrics and logging code.

**Architecture:** Prometheus scrapes Nomad, Consul, and the iptables-exporter (from Plan 04). Grafana provides dashboards. Loki + Promtail collect container logs. Alertmanager handles alerts (including egress alerts from Plan 04). All components run as Nomad jobs.

**Tech Stack:** Prometheus, Grafana, Loki, Promtail, Alertmanager, Nomad

**Depends on:** Plan 01 (working cluster), Plan 04 (iptables-exporter)

---

## File Structure

```
agent-hosting-v2/
  nomad/
    jobs/
      prometheus.nomad.hcl
      grafana.nomad.hcl
      loki.nomad.hcl
      promtail.nomad.hcl
    configs/
      prometheus.yml               # Prometheus scrape config
      promtail.yml                 # Promtail config (tail Nomad alloc logs)
      grafana-datasources.yml      # Grafana auto-provisioned datasources
    dashboards/
      nomad-cluster.json           # Pre-built Nomad dashboard
      crabshack-agents.json        # Custom agent dashboard
```

---

### Task 1: Prometheus Nomad job + config

**Files:**
- Create: `nomad/configs/prometheus.yml`
- Create: `nomad/jobs/prometheus.nomad.hcl`

- [ ] **Step 1: Write Prometheus scrape config**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: nomad
    consul_sd_configs:
      - server: localhost:8500
    relabel_configs:
      - source_labels: [__meta_consul_tags]
        regex: .*,http,.*
        action: keep

  - job_name: consul
    static_configs:
      - targets: ["localhost:8500"]
    metrics_path: /v1/agent/metrics
    params:
      format: [prometheus]

  - job_name: iptables-exporter
    consul_sd_configs:
      - server: localhost:8500
        services: [iptables-exporter]

rule_files:
  - /etc/prometheus/alerts/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["localhost:9093"]
```

- [ ] **Step 2: Write Nomad job for Prometheus**

Standard service job running Prometheus Docker image, with config file templated in via Nomad `template` block, persistent volume for data.

- [ ] **Step 3: Commit**

```bash
git add nomad/configs/prometheus.yml nomad/jobs/prometheus.nomad.hcl
git commit -m "feat: Prometheus Nomad job with Consul SD scrape config"
```

---

### Task 2: Grafana Nomad job + datasources

**Files:**
- Create: `nomad/configs/grafana-datasources.yml`
- Create: `nomad/jobs/grafana.nomad.hcl`

- [ ] **Step 1: Write Grafana datasource provisioning**

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://{{ range service "prometheus" }}{{ .Address }}:{{ .Port }}{{ end }}
    isDefault: true
  - name: Loki
    type: loki
    access: proxy
    url: http://{{ range service "loki" }}{{ .Address }}:{{ .Port }}{{ end }}
```

- [ ] **Step 2: Write Nomad job for Grafana**

Service job running Grafana Docker image with auto-provisioned datasources.

- [ ] **Step 3: Commit**

```bash
git add nomad/configs/grafana-datasources.yml nomad/jobs/grafana.nomad.hcl
git commit -m "feat: Grafana Nomad job with Prometheus + Loki datasources"
```

---

### Task 3: Loki + Promtail Nomad jobs

**Files:**
- Create: `nomad/configs/promtail.yml`
- Create: `nomad/jobs/loki.nomad.hcl`
- Create: `nomad/jobs/promtail.nomad.hcl`

- [ ] **Step 1: Write Promtail config (tails Nomad alloc logs)**

```yaml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: nomad-allocs
    static_configs:
      - targets: [localhost]
        labels:
          __path__: /var/lib/nomad/alloc/*/alloc/logs/*.stdout.*
          source: nomad
    pipeline_stages:
      - regex:
          expression: '/var/lib/nomad/alloc/(?P<alloc_id>[^/]+)/'
      - labels:
          alloc_id:
```

- [ ] **Step 2: Write Loki Nomad job (service type, persistent storage)**

- [ ] **Step 3: Write Promtail Nomad job (system type — runs on every node)**

- [ ] **Step 4: Commit**

```bash
git add nomad/configs/promtail.yml nomad/jobs/loki.nomad.hcl nomad/jobs/promtail.nomad.hcl
git commit -m "feat: Loki + Promtail Nomad jobs for log aggregation"
```

---

### Task 4: Dashboards

**Files:**
- Create: `nomad/dashboards/crabshack-agents.json`

- [ ] **Step 1: Create a custom Grafana dashboard for CrabShack**

Panels:
- Active instances (count by service type)
- Per-instance CPU/memory usage (from Nomad metrics)
- Egress drop rate (from iptables-exporter)
- Recent deploys (from Nomad job events)
- Instance health status (from Consul checks)

Export as JSON for Grafana provisioning.

- [ ] **Step 2: Commit**

```bash
git add nomad/dashboards/
git commit -m "feat: Grafana dashboard for CrabShack agent monitoring"
```

---

### Task 5: Deploy and validate the full stack

- [ ] **Step 1: Deploy all observability jobs**

```bash
nomad job run nomad/jobs/prometheus.nomad.hcl
nomad job run nomad/jobs/grafana.nomad.hcl
nomad job run nomad/jobs/loki.nomad.hcl
nomad job run nomad/jobs/promtail.nomad.hcl
```

- [ ] **Step 2: Verify Prometheus is scraping targets**

Open Prometheus UI, check Targets page — should show Nomad, Consul, and iptables-exporter targets.

- [ ] **Step 3: Verify Grafana shows data**

Open Grafana UI, check the CrabShack dashboard — panels should populate.

- [ ] **Step 4: Verify Loki receives logs**

In Grafana, query Loki: `{source="nomad"}` — should show recent container logs.

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "test: validated observability stack end-to-end"
```
