# CrabShack v2: Nomad-Based Agent Hosting

## Goals

- **Reduce maintenance burden** — replaced ~60% of custom code with battle-tested infrastructure tools
- **Operational maturity** — production-grade reliability, observability, and on-call tooling

## Constraints

- Runs on bare-metal and self-managed VMs (no managed platforms)
- Sysbox isolation is essential — agents need full nested Docker environments
- Single-node deploy is the recommended path; multi-node clustering supported via separate bootstrap scripts

## Architecture Overview

The previous monolithic Bun.js API (~4,200 LOC) was replaced with a thin ~1,500 LOC API backed by Nomad:

| Layer | Tool | Replaces |
|-------|------|----------|
| Cluster orchestration | Nomad (server + client agents) | `ha/`, `ssh/`, `node/`, instance scheduling, health polling |
| Service discovery | Nomad allocation API | Custom SQLite lookups, peer health |
| Backups | Restic (Nomad batch jobs) | `backup/`, `s3/`, custom vault encryption |
| Observability | Prometheus + Grafana + Loki | Custom metrics collector, debug logging, egress alerts |
| Control plane API | Thin Bun.js API (~1,500 LOC) | Previous 4,200 LOC API |
| Ops visibility | Nomad built-in UI | Admin dashboard portion of previous UI |
| User portal | React app (~1,500 LOC) | Previous 3,500 LOC UI |

### What stays custom

- Egress iptables rules (shell scripts invoked as Nomad poststart/poststop lifecycle hooks)
- User-facing portal (create agent, credentials, backup triggers)
- Auth (bearer tokens, user management)
- Gateway proxy / WebSocket bridge to agent containers (routing via Nomad allocation lookup)
- Cloudflare tunnel integration and subdomain routing (`<agent-name>.<zone>`)
- Nomad HCL job template rendering for three service types plus backup/restore
- Deploy progress streaming (SSE via polling Nomad evaluation/allocation status)

### What was deleted

- `ha/` — leader election, write forwarding, peer health, sync loop, P2P SQLite replication
- `ssh/` — remote execution via SSH, compose env writing
- `node/` — node registration, diagnostics
- `s3/` — S3 client
- `backup/` — custom backup/restore logic
- `metrics/` — custom metrics collector
- `auth/key-vault.ts` — in-RAM encrypted key vault (Restic handles backup encryption)
- `mycelium-p2p-sql` dependency

### What was simplified

- `instance/` — reduced to Nomad job submission + SQLite metadata storage
- `types/` — shrunk to match reduced domain model
- `main.ts`, `config.ts`, `debug.ts` — rewritten for the thinner server

## Nomad Job Model

Each agent instance becomes a Nomad job. The three service types map as follows:

| Service type | Nomad job structure |
|---|---|
| `openclaw` | Single task: container with gateway + SSH |
| `ironclaw` | Task group with 2 tasks: worker + openssh sidecar (shared `host_volume`) |
| `ironclaw-dind` | Single task: Sysbox container with nested Docker daemon |

HCL job templates live in `nomad/templates/` (~60-80 lines each). The API's `template-render.ts` performs variable substitution, preserving `${NOMAD_*}` runtime variables.

### Sysbox integration

Nomad's Docker driver supports the `runtime` config parameter:

```hcl
job "agent-example" {
  group "agent" {
    network {
      port "gateway" {}
      port "ssh" {}
    }

    task "agent" {
      driver = "docker"
      config {
        image   = "ironclaw-dind:latest"
        runtime = "sysbox-runc"
        ports   = ["gateway", "ssh"]
      }
      resources {
        memory = 4096
        cpu    = 1000
      }
    }
  }
}
```

**Configuration requirement:** Nomad client must explicitly allow the runtime:
```hcl
plugin "docker" {
  config {
    allow_runtimes = ["runc", "sysbox-runc"]
    volumes { enabled = true }
  }
}
```

This is handled by the bootstrap scripts (`infra/scripts/deploy.sh`, `infra/scripts/bootstrap-client.sh`).

### Port allocation

Each service type declares its required ports in the `network` stanza:

| Service type | Ports |
|---|---|
| `openclaw` | `gateway` (3000), `ssh` (22) |
| `ironclaw` | `gateway` (3000, worker), `ssh` (2222, sidecar) |
| `ironclaw-dind` | `gateway` (3000), `ssh` (2222) |

Nomad assigns dynamic host ports mapped to these container ports. The API resolves assigned ports via the Nomad allocation API (`src/proxy/resolve-alloc.ts`).

### Health checks

Defined in the HCL job spec (TCP checks on gateway and SSH ports). Replaces custom `pollHealth` loop.

### Egress filtering

**Implemented as poststart + poststop lifecycle hooks** via shell scripts in `nomad/scripts/`:

- `apply-egress.sh` — runs after container starts, inspects the container's IP via Docker API, creates a per-container iptables chain (`CRABSHACK-<alloc-id>`), allows DNS (53), HTTP (80), HTTPS (443), drops everything else
- `remove-egress.sh` — runs after container stops, removes the iptables chain and FORWARD rules

These scripts are deployed to `/usr/local/bin/` on each node by the bootstrap scripts and referenced in each job template.

### Egress monitoring

- A Nomad **system job** (`nomad/jobs/iptables-exporter.nomad.hcl`) runs `nomad/scripts/iptables-exporter.sh` on every node, exposing DROP counter metrics as Prometheus-format text on port 9119
- **Prometheus** scrapes these exporters
- **Alertmanager** fires alerts (including Slack) when drop rates exceed thresholds, configured via `nomad/configs/egress-alerts.yml`

### DinD worker image distribution

The `ironclaw-dind` job mounts a pre-built worker image tarball from the host:

```hcl
config {
  volumes = ["/data/crabshack/images/ironclaw-sandbox-worker.tar:/opt/.worker-image.tar:ro"]
}
```

Image distribution to nodes is handled by the bootstrap script.

## Thin API

The Bun.js API (`src/`) is a ~1,500 LOC translation layer between users and Nomad:

| Module | Purpose | ~LOC |
|---|---|---|
| `routes/instance-routes.ts` | Instance CRUD + lifecycle (create/stop/start/restart/delete) + SSH/logs/stats | ~200 |
| `routes/auth-routes.ts` | Bearer token validation (timing-safe comparison) | ~30 |
| `routes/user-routes.ts` | User + token management (admin only) | ~60 |
| `routes/backup-routes.ts` | Dispatch Restic backup/restore batch jobs | ~60 |
| `routes/node-routes.ts` | List Nomad nodes (admin) | ~20 |
| `routes/health-routes.ts` | Health check (no auth required) | ~5 |
| `proxy/gateway-proxy.ts` | HTTP reverse proxy to agent gateways | ~50 |
| `proxy/ws-handler.ts` | WebSocket proxy for terminals | ~40 |
| `proxy/resolve-alloc.ts` | Nomad allocation lookup helpers | ~40 |
| `nomad/nomad-client.ts` | Nomad HTTP API wrapper (submit, stop, start, purge, logs, stats, variables) | ~120 |
| `stream/deploy-stream.ts` | Poll Nomad allocations → SSE events | ~80 |
| `template-render.ts` | HCL template variable substitution with safety checks | ~50 |
| `db/schema.ts`, `db/instance-queries.ts`, `db/user-queries.ts` | SQLite schema + CRUD | ~120 |
| `config.ts`, `debug.ts`, `main.ts` | Config loading, debug logging, route dispatch | ~80 |

### Database

SQLite stores users, access tokens, and instance metadata. Three tables:

- **`users`** — id, name, created_at, is_admin
- **`access_tokens`** — token, user_id, created_at, expires_at, label
- **`instances`** — name (PK), user_id, service_type, nomad_job_id, status, image, mem_limit, cpus, storage_size, ssh_pubkey, token, node_id, meta (JSON), error_message

No cluster state, vault, or replication tables. Single-writer, no P2P replication needed.

### Secrets management

- **Agent API keys and env vars:** Stored as Nomad Variables (`crabshack/<instance-name>`) via `putNomadVariable()`. Referenced in job templates via `{{ with nomadVar }}` blocks. Nomad Variables are encrypted at rest.
- **Backup credentials:** Stored as a shared Nomad Variable (`crabshack/backup-config`), seeded at API startup from environment variables.
- **Instance tokens:** Stored in the API's SQLite database.
- **In-RAM vault:** Deleted. No longer needed since per-instance encryption keys were removed.

**Security note:** The previous in-RAM-only vault meant secrets were never on disk. Nomad Variables persist encrypted at rest but do exist on disk. This is an acceptable trade-off for this deployment.

### Service discovery

Service discovery uses **Nomad allocation queries directly** — no Consul. When the API needs to route to an agent container:

1. Query Nomad for job allocations (`GET /v1/job/<id>/allocations`)
2. Find the running allocation and extract dynamic port mappings
3. Return `{ address, port }` for the requested port label

This is handled by `src/proxy/resolve-alloc.ts`.

## Ingress: Cloudflare Tunnel + Subdomain Routing

External access to agents works via:
- Cloudflare tunnel (managed by `ui/src/tunnel.ts`, `ui/src/cf-api.ts`)
- Subdomain routing (`<agent-name>.<zone>` via `ui/src/host-routing.ts`)
- CNAME record creation via Cloudflare API

The UI server (`ui/src/ui-server.ts`, port 3000) handles multi-tenant subdomain routing:

| Subdomain | Target |
|---|---|
| `{zone}` | User portal |
| `admin.{zone}` | Admin dashboard |
| `api.{zone}` | API passthrough |
| `{agent-name}.{zone}` | Agent gateway proxy |

Instead of looking up instance → node → port in SQLite, the proxy resolves the Nomad allocation to find node + dynamic port.

## Node Bootstrap & Deployment

### Single-node deploy (recommended)

`infra/scripts/deploy.sh` is the recommended path for production VMs. A single idempotent script that:

1. Installs Docker CE (with log rotation config)
2. Installs Sysbox CE 0.6.6
3. Installs Nomad 1.7.7 (server + client mode, `bootstrap_expect = 1`)
4. Installs Bun runtime
5. Deploys egress scripts to `/usr/local/bin/`
6. Runs `bun install` for dependencies
7. Creates a `crabshack-api` systemd service

```bash
sudo bash infra/scripts/deploy.sh <ADMIN_SECRET> [APP_DIR] [PORT]
```

### Multi-node production

Separate bootstrap scripts for server and client nodes:

```bash
# Server nodes (×3 for HA):
ssh root@10.0.0.1 'bash -s' < infra/scripts/bootstrap-server.sh 10.0.0.1,10.0.0.2,10.0.0.3

# Client nodes (×N):
ssh root@10.0.1.1 'bash -s' < infra/scripts/bootstrap-client.sh 10.0.0.1,10.0.0.2,10.0.0.3
```

Server nodes run Nomad in server mode only (`bootstrap_expect = 3`). Client nodes run Nomad in client mode with `retry_join` for auto-discovery. Docker plugin configured with `allow_runtimes = ["runc", "sysbox-runc"]`.

### Local development

```bash
sudo bash infra/scripts/bootstrap-local-dev.sh   # Nomad only, dev mode
bash infra/scripts/validate-cluster.sh            # Health checks
bun install && CRABSHACK_ADMIN_SECRET=dev-secret bun src/main.ts
```

### Data directories

| Path | Purpose |
|---|---|
| `/opt/nomad/data` | Nomad state |
| `/data/crabshack/images` | Container image tarballs |
| `/data/crabshack/agent-data` | Host volumes for agent instances |
| `./crabshack-data/crabshack.db` | SQLite database |

## Observability

All observability tools run as Nomad jobs (`nomad/jobs/`):

| Concern | Tool | Job file | Port | Notes |
|---|---|---|---|---|
| Metrics | Prometheus | `prometheus.nomad.hcl` | 9090 | Scrapes Nomad + iptables-exporter. 30-day retention. |
| Dashboards | Grafana | `grafana.nomad.hcl` | 3001 | Auto-provisioned datasources for Prometheus + Loki. |
| Logs | Loki | `loki.nomad.hcl` | 3100 | Centralized log aggregation. |
| Log shipping | Promtail | `promtail.nomad.hcl` | — | System job, tails Docker container logs on every node. |
| Egress metrics | iptables-exporter | `iptables-exporter.nomad.hcl` | 9119 | System job, per-node DROP counter metrics. |
| Alerting | Alertmanager | (via Prometheus) | — | Rules in `nomad/configs/egress-alerts.yml`. |

## Backups

**Restic** handles backup/restore via Nomad batch jobs:

- `nomad/templates/backup.nomad.hcl` — runs `nomad/scripts/restic-backup.sh`
- `nomad/templates/restore.nomad.hcl` — runs `nomad/scripts/restic-restore.sh`

Features:
- Incremental, deduplicated backups to S3-compatible storage
- Repo-level encryption via `CRABSHACK_RESTIC_PASSWORD` (stored as Nomad Variable)
- Retention: 7 daily, 4 weekly, 3 monthly
- Periodic scheduled backups via `nomad/jobs/backup-periodic.nomad.hcl`

API triggers:
```
POST /instances/:name/backup   → dispatches backup batch job
POST /instances/:name/restore/:id → dispatches restore batch job
```

### Security trade-off

The previous system used per-instance age keypairs derived from user-supplied passphrases (platform operator could not decrypt without the user's passphrase). Restic uses platform-controlled repo-level encryption. This is an acceptable trade-off for the current operator-trusted model.

## User Portal

The React UI (`ui/src/`) provides:

| Component | Purpose |
|---|---|
| `App.tsx` | Root component, routing |
| `InstanceList.tsx` | List user's agent instances |
| `CreateAgentForm.tsx` | Create new agent instance |
| `AgentBackups.tsx` | Trigger backup/restore |
| `UserList.tsx` | User management (admin) |
| `api.ts` | API client wrapper |

Infrastructure components:
| File | Purpose |
|---|---|
| `ui-server.ts` | Bun.js server (port 3000), subdomain routing |
| `ui-api-routes.ts` | UI-specific API handlers |
| `auth.ts` | Cookie-based auth (SHA256 hashed secret) |
| `host-routing.ts` | Subdomain extraction and routing |
| `proxy.ts` | API + agent gateway proxying |
| `ws-bridge.ts` | WebSocket bridge for terminal access |
| `tunnel.ts` | Cloudflare tunnel integration |
| `cf-api.ts` | Cloudflare API (DNS record management) |

Admin/ops views (node management, diagnostics, event logs) are handled by the Nomad built-in UI and Grafana dashboards.

## Environment Variables

### API Server

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CRABSHACK_ADMIN_SECRET` | Yes | — | Admin bearer token |
| `CRABSHACK_PORT` | No | `7700` | API listen port |
| `CRABSHACK_DATA_DIR` | No | `./crabshack-data` | SQLite directory |
| `CRABSHACK_DEBUG` | No | — | Enable debug logging (`1`) |
| `NOMAD_ADDR` | No | `http://127.0.0.1:4646` | Nomad API address |
| `NOMAD_TOKEN` | No | — | Nomad ACL token |

### Backup configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CRABSHACK_RESTIC_PASSWORD` | If backups used | — | Restic repo encryption |
| `CRABSHACK_S3_ENDPOINT` | No | `s3.amazonaws.com` | S3-compatible endpoint |
| `CRABSHACK_S3_BUCKET` | No | `crabshack-backups` | Bucket name |
| `CRABSHACK_S3_ACCESS_KEY` | If backups used | — | S3 access key |
| `CRABSHACK_S3_SECRET_KEY` | If backups used | — | S3 secret key |

### UI Server

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CRABSHACK_ADMIN_SECRET` | Yes | — | Shared with API |
| `CRABSHACK_UI_PORT` | No | `3000` | UI listen port |
| `CRABSHACK_API_URL` | No | `http://localhost:7700` | API URL |
| `CRABSHACK_UI_ZONE` | No | — | Domain for subdomain routing |
| `CRABSHACK_UI_CF_TOKEN` | No | — | Cloudflare tunnel token |
| `CRABSHACK_CF_API_TOKEN` | No | — | Cloudflare API token |
| `CRABSHACK_DEBUG` | No | — | Debug logging |

## Security Model

### Container isolation
- **Sysbox runtime:** containers get their own user namespace (uid 0 inside maps to unprivileged uid outside)
- **No privileged containers:** Sysbox enables DinD without `--privileged`
- **Read-only mounts:** worker tarballs mounted `:ro`

### Network egress control
- Per-container iptables chain `CRABSHACK-<alloc-id>`
- **Allowlist:** DNS (UDP 53), HTTP (TCP 80), HTTPS (TCP 443) — everything else dropped
- Applied via Nomad poststart hook (`apply-egress.sh`), cleaned up on poststop (`remove-egress.sh`)

### Access control
- Bearer token required on all API calls (except `/health`)
- Timing-safe token comparison via `crypto.timingSafeEqual`
- Admin secret for privileged operations (user/token management, node listing)
- Non-admin users see only their own instances
- Tokens support optional expiration

### Template safety
- Service type validated against allowlist (prevents path traversal)
- HCL values sanitized (escape `"`, `$`, newlines)
- `${NOMAD_*}` variables preserved for runtime substitution

## Summary

| Metric | Before | After |
|---|---|---|
| Custom code | ~7,800 LOC | ~3,000 LOC |
| External dependencies | 1 (mycelium-p2p-sql) | Nomad, Restic, Prometheus, Grafana, Loki |
| Node management | Custom SSH + registration API | Nomad agent auto-join |
| HA / replication | Custom leader election + P2P SQLite sync | Nomad Raft (built-in) |
| Scheduling | Custom bin-packing in TypeScript | Nomad scheduler |
| Health checks | Custom `pollHealth` loop | Nomad native checks |
| Service discovery | SQLite lookups | Nomad allocation API |
| Backups | Custom S3 client + per-instance encryption | Restic + Nomad batch jobs |
| Observability | Custom metrics collector + debug logs | Prometheus + Grafana + Loki |
| Secrets | Custom in-RAM vault with P2P replication | Nomad Variables (encrypted at rest) |
| Ingress | Cloudflare tunnel + custom routing | Cloudflare tunnel + Nomad allocation routing |

### Trade-offs accepted

1. **Dependencies** increased from 1 to ~5, but these are mature, widely-deployed infrastructure tools. Maintenance shifted from "fix your own orchestrator" to "keep standard infrastructure updated."
2. **No Consul** — the original design called for Consul for service discovery and KV, but Nomad's allocation API proved sufficient. This removed a dependency at the cost of slightly more API-level routing code.
3. **Backup encryption** moved from per-user keys to platform-controlled keys. Acceptable in operator-trusted model.
4. **Secrets on disk** — Nomad Variables persist encrypted at rest, vs. previous in-RAM-only vault. Weaker guarantee, acceptable for this deployment.
