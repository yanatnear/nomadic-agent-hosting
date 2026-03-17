# Architecture — Agent Hosting v2

Container orchestration platform for running NEAR AI agent instances. Replaces a 4,200+ LOC monolith with a ~1,500 LOC Bun.js API backed by HashiCorp Nomad, deployed on Sysbox-enabled Docker infrastructure.

---

## System Overview

```
┌──────────────────────────────────────────────────┐
│           Client Layer (React UI / CLI)           │
│        Cloudflare Pages + Ingress Proxy           │
└──────────────────────┬───────────────────────────┘
                       │ HTTP / WebSocket / SSE
                       ▼
┌──────────────────────────────────────────────────┐
│            Bun.js REST API (port 7700)            │
│  Instance CRUD · Auth · Gateway Proxy · SSE       │
│  Backup/Restore · SQLite Metadata Store           │
└──────┬─────────────────────────────┬─────────────┘
       │                             │
       ▼                             ▼
  ┌──────────────────────────────────────────────┐
  │       Nomad Cluster                           │
  │                                               │
  │  Servers (×3): HTTP API, scheduling, Raft     │
  │  Clients (×N): Docker + Sysbox, workloads     │
  │                                               │
  │  ┌─────────────────────────────────────────┐  │
  │  │   Agent Instances (Sysbox containers)    │  │
  │  │   • Gateway task (port 3000)             │  │
  │  │   • SSH sidecar (port 2222)              │  │
  │  │   • Egress rules (iptables)              │  │
  │  └─────────────────────────────────────────┘  │
  │                                               │
  │  System Jobs: Promtail · iptables-exporter    │
  └──────────────────────────────────────────────┘
                                ┌───────────────┐
                                │  Prometheus   │
                                │  Grafana      │
                                │  Loki (logs)  │
                                └───────────────┘
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| API Server | Bun.js (TypeScript) |
| Database | SQLite (users, instances, tokens) |
| Orchestration | Nomad 1.7+ |
| Container Runtime | Docker 24+ with Sysbox 0.6.6+ |
| Frontend | React + TypeScript (Cloudflare Pages) |
| Metrics | Prometheus + Grafana |
| Logs | Loki + Promtail |
| Infra-as-Code | Bash bootstrap scripts |
| Backups | Restic (batch Nomad jobs) |

---

## Source Code Organization

### `/src` — API Server

```
src/
├── main.ts                    # Server entrypoint (Bun.serve), route dispatch
├── config.ts                  # Env var loading & validation
├── debug.ts                   # Conditional debug logging
├── template-render.ts         # HCL template variable substitution
│
├── db/
│   ├── schema.ts              # SQLite schema initialization
│   ├── instance-queries.ts    # Instance CRUD
│   └── user-queries.ts        # User & token CRUD
│
├── nomad/
│   └── nomad-client.ts        # Nomad HTTP API wrapper (submit, stop, start, purge, logs, stats, port resolution)
│
├── auth/
│   └── bearer-auth.ts         # Bearer token extraction & validation
│
├── routes/
│   ├── instance-routes.ts     # Instance CRUD + lifecycle (start/stop/restart)
│   ├── user-routes.ts         # User management (admin)
│   ├── auth-routes.ts         # Login + token creation
│   ├── backup-routes.ts       # Backup/restore triggers
│   ├── node-routes.ts         # Nomad node listing
│   └── health-routes.ts       # Health check (no auth)
│
├── proxy/
│   ├── gateway-proxy.ts       # HTTP reverse proxy to agent gateways
│   ├── ws-handler.ts          # WebSocket proxy for terminals
│   └── resolve-alloc.ts       # Nomad allocation lookup helpers
│
└── stream/
    └── deploy-stream.ts       # Poll Nomad allocations → SSE events
```

### `/nomad` — Job Templates & Scripts

```
nomad/
├── templates/
│   ├── openclaw.nomad.hcl       # Single-container (gateway + SSH)
│   ├── ironclaw.nomad.hcl       # Worker + SSH sidecar, shared volume
│   ├── ironclaw-dind.nomad.hcl  # Sysbox DinD container
│   ├── backup.nomad.hcl         # Restic backup batch job
│   └── restore.nomad.hcl        # Restic restore batch job
│
├── scripts/
│   ├── apply-egress.sh          # Poststart: iptables allowlist per container
│   ├── remove-egress.sh         # Poststop: clean up iptables chains
│   ├── iptables-exporter.sh     # System job: Prometheus drop counter metrics
│   ├── restic-backup.sh         # Backup task
│   └── restic-restore.sh        # Restore task
│
└── configs/
    ├── prometheus.yml           # Scrape config (Nomad, iptables-exporter)
    ├── grafana-datasources.yml  # Grafana auto-provisioning
    └── promtail.yml             # Log tailing config
```

### `/infra` — Infrastructure as Code

```
infra/
├── scripts/
│   ├── deploy.sh                # Single-node full deploy (Docker+Sysbox+Nomad+API)
│   ├── bootstrap-server.sh      # Multi-node: provision a Nomad server
│   ├── bootstrap-client.sh      # Multi-node: provision a Nomad client
│   ├── bootstrap-local-dev.sh   # Single-node dev cluster setup (Nomad only)
│   └── validate-cluster.sh      # Health checks (Nomad, Docker, Sysbox)
│
└── configs/
    └── nomad-docker-plugin.hcl  # Sysbox Docker plugin reference
```

### `/ui` — React Frontend

```
ui/src/
├── App.tsx              # Root component
├── InstanceList.tsx     # List/create instances
├── CreateAgentForm.tsx  # Instance creation form
├── AgentBackups.tsx     # Backup management
├── api.ts              # API client wrapper
├── ui-server.ts        # Standalone UI server
├── ws-bridge.ts        # WebSocket bridge for terminal
├── tunnel.ts           # Cloudflare tunnel integration
└── host-routing.ts     # Multi-tenant subdomain routing
```

---

## API Design

### Authentication

- **Bearer tokens** in `Authorization: Bearer <token>` header on all endpoints (except `/health`)
- **Admin secret** (`CRABSHACK_ADMIN_SECRET` env var) for privileged operations
- Tokens stored in SQLite with optional expiration

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/instances` | Create instance (SSE deployment stream) |
| `GET` | `/instances` | List instances (scoped by user) |
| `GET` | `/instances/:name` | Instance details + live ports (Nomad) |
| `DELETE` | `/instances/:name` | Delete instance (Nomad purge) |
| `POST` | `/instances/:name/stop` | Stop instance |
| `POST` | `/instances/:name/start` | Start stopped instance |
| `POST` | `/instances/:name/restart` | Restart instance |
| `GET` | `/instances/:name/ssh` | SSH connection info |
| `GET` | `/instances/:name/logs` | Fetch logs (tail param) |
| `GET` | `/instances/:name/stats` | Resource usage stats |
| `POST` | `/instances/:name/backup` | Trigger Restic backup |
| `POST` | `/instances/:name/restore/:id` | Trigger Restic restore |
| `GET` | `/nodes` | List Nomad nodes |
| `GET/POST` | `/users` | User management (admin) |
| `POST` | `/tokens` | Create API token (admin) |
| `GET` | `/gateway/:name/*` | Reverse proxy to agent gateway |
| `GET` | `/health` | Health check (no auth) |

---

## Service Types

Three Nomad job templates define the agent deployment flavors:

| Type | Template | Description |
|------|----------|-------------|
| `openclaw` | `openclaw.nomad.hcl` | Single container with gateway (port 3000) + SSH |
| `ironclaw` | `ironclaw.nomad.hcl` | Worker + SSH sidecar with shared volume |
| `ironclaw-dind` | `ironclaw-dind.nomad.hcl` | Sysbox DinD container with worker tarball (read-only mount) |

Each template declares two dynamic ports (`gateway` and `ssh`) in its network block. The API resolves these ports via the Nomad allocation API.

---

## Key Patterns

### Template Rendering

HCL templates use `${VAR_NAME}` placeholders. The renderer (`template-render.ts`):
1. Loads the template from disk
2. Substitutes application variables (`INSTANCE_NAME`, `IMAGE`, `MEM_LIMIT`, etc.)
3. Preserves `${NOMAD_*}` variables for Nomad runtime substitution
4. Throws on missing required variables

### Service Discovery (via Nomad)

When a client requests instance details or the gateway proxy is invoked:
1. Query Nomad for job allocations (`GET /v1/job/<id>/allocations`)
2. Find the running allocation and extract dynamic port mappings
3. Return `{ address, port }` for the requested port label (`gateway` or `ssh`)

### Deployment Progress (SSE)

1. Submit job to Nomad → get Evaluation ID
2. Poll `/v1/evaluation/<id>/allocations` every 1s (up to 30s)
3. Once allocated, poll `/v1/allocation/<id>` every 1s (up to 120s)
4. Stream status changes to client as SSE events: `pending` → `running` | `error`

### Instance Lifecycle

```
pending → creating → running ⇄ stopped → deleted
              ↘     error    ↗
```

- **Create:** render template → `submitJob()` (parse + submit)
- **Stop:** `stopJob()` (soft stop, job persists)
- **Start:** `startJob()` (re-submit with Stop=false)
- **Restart:** stop → 2s delay → start
- **Delete:** `purgeJob()` (hard delete)

---

## Security Model

### Container Isolation
- **Sysbox runtime:** containers get their own user namespace (uid 0 inside maps to unprivileged uid outside)
- **No privileged containers:** Sysbox enables DinD without `--privileged`
- **Read-only mounts:** worker tarballs mounted `:ro`

### Network Egress Control
- Per-container iptables chain `CRABSHACK-<alloc-id>`
- **Allowlist:** DNS (53), HTTP (80), HTTPS (443) — everything else dropped
- Applied via Nomad poststart hook (`apply-egress.sh`), cleaned up on poststop (`remove-egress.sh`)

### Access Control
- Bearer token required on all API calls (except `/health`)
- Admin secret for privileged operations (user/token management)
- Non-admin users see only their own instances
- Tokens support optional expiration

---

## Infrastructure & Deployment

### Cluster Topology

- **3 server nodes:** Nomad servers (Raft consensus, control plane only)
- **N client nodes:** Nomad clients, Docker + Sysbox, workload scheduling
- Clients auto-join via `retry_join` configuration

### Setup

**Single-node deploy (recommended):**

`deploy.sh` is the recommended path for GCloud VMs. It installs Docker, Sysbox, Nomad, Bun, deploys egress scripts, and starts the CrabShack API as a systemd service — all in one idempotent script.

```bash
sudo bash infra/scripts/deploy.sh <ADMIN_SECRET> [APP_DIR] [PORT]
```

**Single-node dev (minimal, Nomad only):**
```bash
sudo bash infra/scripts/bootstrap-local-dev.sh
bash infra/scripts/validate-cluster.sh
```

**Multi-node production:**
```bash
# On each server node (or via ssh):
ssh root@10.0.0.1 'bash -s' < infra/scripts/bootstrap-server.sh 10.0.0.1,10.0.0.2,10.0.0.3

# On each client node:
ssh root@10.0.1.1 'bash -s' < infra/scripts/bootstrap-client.sh 10.0.0.1,10.0.0.2,10.0.0.3
```

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `CRABSHACK_ADMIN_SECRET` | (required) | Admin token validation |
| `CRABSHACK_PORT` | `7700` | API listen port |
| `CRABSHACK_DATA_DIR` | `./crabshack-data` | SQLite storage directory |
| `CRABSHACK_DEBUG` | — | Enable debug logging (`1`) |
| `NOMAD_ADDR` | `http://127.0.0.1:4646` | Nomad API address |

---

## Data Flow: Request → Running Agent

```
 User → POST /instances { service_type, image, mem_limit, ... }
   │
   ├─ Validate input, generate name (agent-XXXXXXXX)
   ├─ Load & render HCL template
   ├─ Submit to Nomad API (parse + submit) → Evaluation ID
   ├─ Store in SQLite (status=pending)
   ├─ Open SSE stream to client
   │
   ├─ Poll Nomad: evaluation → allocation (up to 30s)
   ├─ Poll Nomad: allocation → running (up to 120s)
   │
   │   Nomad client node:
   │   ├─ Docker starts container (Sysbox runtime)
   │   ├─ Poststart hook: apply-egress.sh → iptables rules
   │   └─ Nomad tracks dynamic port mappings for the allocation
   │
   ├─ Detect running → update SQLite (status=running)
   └─ Send SSE "ready" → client shows instance
```

Access the running agent:
- **Gateway:** `GET /gateway/<name>/*` → Nomad allocation lookup → HTTP reverse proxy
- **SSH:** `GET /instances/<name>/ssh` → Nomad allocation lookup → returns `{ host, port, user }`
