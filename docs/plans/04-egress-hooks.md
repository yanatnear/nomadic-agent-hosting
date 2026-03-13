# Egress Hooks + Monitoring

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-container egress iptables filtering as Nomad lifecycle hooks, plus a node-level iptables exporter for Prometheus monitoring.

**Architecture:** Poststart hook applies iptables rules after the container starts. Poststop hook cleans up. A Nomad system job runs an iptables-exporter on every node, exposing drop counters as Prometheus metrics. Alertmanager fires Slack alerts on high drop rates.

**Tech Stack:** bash, Nomad lifecycle hooks, Prometheus iptables-exporter, Alertmanager

**Depends on:** Plan 02 (egress scripts already created as part of job templates)

---

## File Structure

```
agent-hosting-v2/
  nomad/
    scripts/
      apply-egress.sh              # (from Plan 02)
      remove-egress.sh             # (from Plan 02)
      iptables-exporter.sh         # Exposes iptables counters as Prometheus metrics
    jobs/
      iptables-exporter.nomad.hcl  # System job: runs exporter on every node
    alerting/
      egress-alerts.yml            # Alertmanager rules for egress anomalies
```

---

### Task 1: iptables-exporter script

**Files:**
- Create: `nomad/scripts/iptables-exporter.sh`

- [ ] **Step 1: Write the exporter**

A simple HTTP server (using socat or netcat) that reads iptables CRABSHACK-* chain counters and serves them in Prometheus exposition format on port 9199.

```bash
#!/usr/bin/env bash
# Serves iptables CRABSHACK-* chain counters as Prometheus metrics.
# Runs as a Nomad system job on every node.
set -euo pipefail

PORT="${1:-9199}"

serve_metrics() {
  local metrics=""
  # Read packet/byte counters from all CRABSHACK-* chains
  while IFS= read -r line; do
    local chain pkts bytes
    chain=$(echo "$line" | awk '{print $2}')
    # Get DROP rule counters for this chain
    local drop_line
    drop_line=$(iptables -L "$chain" -v -n 2>/dev/null | grep -i "DROP" | head -1 || true)
    if [ -n "$drop_line" ]; then
      pkts=$(echo "$drop_line" | awk '{print $1}')
      bytes=$(echo "$drop_line" | awk '{print $2}')
      local alloc_id="${chain#CRABSHACK-}"
      metrics+="crabshack_egress_drops_packets{alloc=\"${alloc_id}\"} ${pkts}\n"
      metrics+="crabshack_egress_drops_bytes{alloc=\"${alloc_id}\"} ${bytes}\n"
    fi
  done < <(iptables -L -n 2>/dev/null | grep "^Chain CRABSHACK-")

  local body
  body="# HELP crabshack_egress_drops_packets Total dropped packets per container\n"
  body+="# TYPE crabshack_egress_drops_packets counter\n"
  body+="# HELP crabshack_egress_drops_bytes Total dropped bytes per container\n"
  body+="# TYPE crabshack_egress_drops_bytes counter\n"
  body+="${metrics}"

  local content_length=${#body}
  printf "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%b" "$content_length" "$body"
}

echo "iptables-exporter listening on :${PORT}"
while true; do
  serve_metrics | socat - TCP-LISTEN:${PORT},reuseaddr,fork 2>/dev/null || sleep 1
done
```

- [ ] **Step 2: Test locally**

Run: `sudo bash nomad/scripts/iptables-exporter.sh 9199 &`
Test: `curl -s http://localhost:9199`
Expected: Prometheus-format metrics output (may be empty if no CRABSHACK chains exist)

- [ ] **Step 3: Commit**

```bash
git add nomad/scripts/iptables-exporter.sh
git commit -m "feat: iptables-exporter for egress drop counter metrics"
```

---

### Task 2: Nomad system job for iptables-exporter

**Files:**
- Create: `nomad/jobs/iptables-exporter.nomad.hcl`

- [ ] **Step 1: Write the system job**

```hcl
job "iptables-exporter" {
  datacenters = ["dc1"]
  type        = "system"

  group "exporter" {
    network {
      port "metrics" { static = 9199 }
    }

    task "exporter" {
      driver = "raw_exec"

      config {
        command = "/usr/local/bin/iptables-exporter.sh"
        args    = ["9199"]
      }

      resources {
        memory = 32
        cpu    = 50
      }

      service {
        name = "iptables-exporter"
        port = "metrics"
        tags = ["prometheus"]

        check {
          type     = "http"
          path     = "/"
          port     = "metrics"
          interval = "30s"
          timeout  = "5s"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Deploy and validate**

```bash
nomad job run nomad/jobs/iptables-exporter.nomad.hcl
nomad job status iptables-exporter
# Check that it's running on all nodes
curl -s http://<any-node>:9199
```

- [ ] **Step 3: Commit**

```bash
git add nomad/jobs/iptables-exporter.nomad.hcl
git commit -m "feat: Nomad system job for iptables-exporter on all nodes"
```

---

### Task 3: Alertmanager rules for egress anomalies

**Files:**
- Create: `nomad/alerting/egress-alerts.yml`

- [ ] **Step 1: Write alert rules**

```yaml
groups:
  - name: crabshack-egress
    interval: 30s
    rules:
      - alert: HighEgressDropRate
        expr: rate(crabshack_egress_drops_packets[5m]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High egress drop rate for alloc {{ $labels.alloc }}"
          description: "Container {{ $labels.alloc }} is dropping >100 packets/sec for 5+ minutes. Possible DDoS attempt or misconfigured egress."

      - alert: VeryHighEgressDropRate
        expr: rate(crabshack_egress_drops_packets[1m]) > 1000
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Very high egress drop rate for alloc {{ $labels.alloc }}"
          description: "Container {{ $labels.alloc }} is dropping >1000 packets/sec. Investigate immediately."
```

- [ ] **Step 2: Commit**

```bash
git add nomad/alerting/egress-alerts.yml
git commit -m "feat: Prometheus alert rules for egress drop rate anomalies"
```

---

### Task 4: End-to-end egress test

- [ ] **Step 1: Create a test container, verify egress rules are applied**

```bash
# Submit a test job (from Plan 02 templates)
# Wait for it to be running
# Verify iptables chain was created
sudo iptables -L | grep CRABSHACK
# Verify the exporter shows metrics
curl -s http://localhost:9199 | grep crabshack_egress
```

- [ ] **Step 2: Stop the job, verify cleanup**

```bash
nomad job stop -purge agent-test
# Verify iptables chain was removed
sudo iptables -L | grep CRABSHACK  # should return nothing
```

- [ ] **Step 3: Commit test notes**

```bash
git commit --allow-empty -m "test: validated egress poststart/poststop hooks end-to-end"
```
