# Nomadic CrabShack — Nomad-based Orchestration for Agent Hosting 

Container orchestration platform for running NEAR AI agent instances. Replaces the v1 monolith (~16k LoC) with ~4.5k LoC of Bun.js + Nomad HCL, delegating scheduling, health checks, and resource management to HashiCorp Nomad.

## Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │                  Clients                        │
                    │   CLI / Web UI / API consumers                  │
                    └──────┬──────────────────┬───────────────────────┘
                           │                  │
                    ┌──────▼──────┐    ┌──────▼──────┐
                    │  UI Server  │    │  API Server  │
                    │  (Bun:3000) │───▶│  (Bun:7700)  │
                    │  Subdomain  │    │  REST + SSE   │
                    │  routing    │    │  SQLite meta   │
                    └─────────────┘    └──────┬────────┘
                                              │
                                       ┌──────▼──────┐
                                       │    Nomad     │
                                       │  API :4646   │
                                       └──────┬───────┘
                                              │
                    ┌─────────────┬────────────┼────────────┐
                    │             │            │            │
               ┌────▼────┐  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
               │ Client  │  │ Client  │  │ Client  │  │ Client  │
               │ Node 1  │  │ Node 2  │  │ Node N  │  │ ...     │
               │ Docker + │  │ Docker + │  │ Docker + │  │         │
               │ Sysbox   │  │ Sysbox   │  │ Sysbox   │  │         │
               └──────────┘  └──────────┘  └──────────┘  └─────────┘
```

**API Server** — Bun.js TypeScript server. Handles auth, instance CRUD, proxying to agent containers, backup/restore. Stores metadata in SQLite. Talks to Nomad's HTTP API for all orchestration.

**UI Server** — Standalone Bun.js server with subdomain-based routing. `{agent}.zone` proxies to the agent's gateway port. `admin.zone` serves the admin dashboard. Optionally manages a Cloudflare tunnel.

**Nomad** — Schedules agent containers across the cluster. Each instance is a Nomad job with HCL rendered from templates. Secrets are stored in Nomad Variables and injected via `template` blocks.

**Client Nodes** — Run Docker with Sysbox runtime for unprivileged Docker-in-Docker. Per-container iptables egress rules restrict outbound traffic.

## Service Types

| Type | Description | Isolation |
|------|-------------|-----------|
| `openclaw` | Single container with built-in gateway + SSH | Docker |
| `ironclaw` | Worker container + SSH sidecar, shared host volume | Docker |
| `ironclaw-dind` | Sysbox container with Docker-in-Docker capability | Sysbox |

## Single-Node Deploy (Recommended)

The fastest way to get a fully working instance on a GCloud Ubuntu 22.04+ VM. Installs Docker, Sysbox, Nomad, Bun, egress scripts, and starts the CrabShack API — all as a single idempotent script.

```bash
# Clone the repo on the VM first, then:
sudo bash infra/scripts/deploy.sh <ADMIN_SECRET> [APP_DIR] [PORT]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_SECRET` | Yes | — | `CRABSHACK_ADMIN_SECRET` value |
| `APP_DIR` | No | `/home/$SUDO_USER/agent-hosting-v2` | Path to cloned repo |
| `PORT` | No | `7700` | API listen port |

After deploy completes, validate:
```bash
bash infra/scripts/validate-cluster.sh
curl http://localhost:7700/health
```

The script creates three systemd services: `nomad`, `crabshack-api`, and `crabshack-ui`. Manage with `systemctl {start,stop,restart,status} <service>`.

### GCP Firewall Rules

For GCloud deployments, set up the required firewall rules:

```bash
bash infra/scripts/gcloud-firewall.sh <PROJECT_ID>
```

This creates rules for:

| Port | Service | Auth | Network Tag |
|------|---------|------|-------------|
| 22 | SSH | Key-based | `ssh-server` |
| 3000 | CrabShack UI | Cookie/secret | `http-server` |
| 7700 | CrabShack API | Bearer token | `http-server` |
| 19001-29999 | Agent dynamic ports | Per-instance token | `crabshack-node` |

The **Nomad UI (4646) is intentionally not exposed** — it has no authentication. Access it via SSH tunnel:

```bash
gcloud compute ssh <INSTANCE> --zone=<ZONE> -- -L 4646:localhost:4646
# Then open http://localhost:4646
```

Ensure your VM has the required network tags: `http-server`, `crabshack-node`, `ssh-server`.

## Quick Start (Local Dev)

For local development where you only need Nomad (no systemd API service):

```bash
# 1. Bootstrap Nomad + Docker + Sysbox
sudo bash infra/scripts/bootstrap-local-dev.sh
bash infra/scripts/validate-cluster.sh

# 2. Install dependencies
bun install

# 3. Set required env vars
export CRABSHACK_ADMIN_SECRET="your-secret-here"

# 4. Start the API server
bun src/main.ts

# 5. (Optional) Start the UI server
CRABSHACK_API_URL=http://localhost:7700 bun ui/src/ui-server.ts
```

## Multi-Node Production Setup

### Server Nodes (3 recommended)

```bash
# On each server node (pass comma-separated server IPs):
ssh root@<server-ip> 'bash -s' < infra/scripts/bootstrap-server.sh 10.0.0.1,10.0.0.2,10.0.0.3
```

### Client Nodes (N workers)

Each client node runs Docker + Sysbox + Nomad client and auto-joins the server cluster. The script installs all dependencies and configures the Docker plugin for Sysbox runtimes.

```bash
# On each client node (pass comma-separated server IPs for auto-join):
ssh root@<client-ip> 'bash -s' < infra/scripts/bootstrap-client.sh 10.0.0.1,10.0.0.2,10.0.0.3
```

What `bootstrap-client.sh` does:
1. Installs Docker CE and Sysbox CE 0.6.6
2. Installs Nomad 1.7.7
3. Writes Nomad client config with the Docker plugin (sysbox-runc + runc, volumes enabled)
4. Creates a systemd unit and starts Nomad, auto-joining the provided server IPs

### Validate

```bash
bash infra/scripts/validate-cluster.sh
```

### Deploy Observability Stack

```bash
nomad job run nomad/jobs/prometheus.nomad.hcl
nomad job run nomad/jobs/grafana.nomad.hcl
nomad job run nomad/jobs/loki.nomad.hcl
nomad job run nomad/jobs/promtail.nomad.hcl
```

## Environment Variables

### API Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRABSHACK_ADMIN_SECRET` | Yes | — | Admin bearer token |
| `CRABSHACK_PORT` | No | `7700` | API listen port |
| `CRABSHACK_DATA_DIR` | No | `./crabshack-data` | SQLite database directory |
| `CRABSHACK_DEBUG` | No | — | Set `1` for debug logging |
| `NOMAD_ADDR` | No | `http://127.0.0.1:4646` | Nomad API address |
| `NOMAD_TOKEN` | No | — | Nomad ACL token |
| `NODE_SSH_HOST` | No | Nomad node public IP / address | Override `/nodes` SSH host for QA and host-level operations |
| `NODE_SSH_PORT` | No | `22` | Override `/nodes` SSH port |
| `NODE_SSH_USER` | No | `yan` | Override `/nodes` SSH user |

### Backups

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRABSHACK_RESTIC_PASSWORD` | If backups | — | Restic encryption password |
| `CRABSHACK_S3_ENDPOINT` | No | `s3.amazonaws.com` | S3-compatible endpoint |
| `CRABSHACK_S3_BUCKET` | No | `crabshack-backups` | Bucket name |
| `CRABSHACK_S3_ACCESS_KEY` | If backups | — | S3 access key |
| `CRABSHACK_S3_SECRET_KEY` | If backups | — | S3 secret key |

### UI Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRABSHACK_ADMIN_SECRET` | Yes | — | Shared with API |
| `CRABSHACK_UI_PORT` | No | `3000` | UI listen port |
| `CRABSHACK_API_URL` | No | `http://localhost:7700` | API server URL |
| `CRABSHACK_UI_ZONE` | No | — | Domain for subdomain routing (e.g. `agents.example.com`) |
| `CRABSHACK_UI_CF_TOKEN` | No | — | Cloudflare tunnel token |
| `CRABSHACK_CF_API_TOKEN` | No | — | Cloudflare API token for DNS |

## API Usage

All endpoints (except `/health`) require `Authorization: Bearer <token>`.

### Create an Instance

```bash
curl -X POST http://localhost:7700/instances \
  -H "Authorization: Bearer $CRABSHACK_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "service_type": "ironclaw-dind",
    "image": "nearaidev/ironclaw-nearai-worker:latest",
    "mem_limit": "2G",
    "cpus": "1",
    "nearai_api_key": "your-nearai-key",
    "nearai_api_url": "https://api.near.ai",
    "ssh_pubkey": "ssh-ed25519 AAAA..."
  }'
```

Returns an SSE stream:
```
event: created
data: {"name":"agent-a1b2c3d4"}

event: pending
data: {"message":"Waiting for scheduling..."}

event: ready
data: {"name":"agent-a1b2c3d4"}
```

### List Instances

```bash
curl http://localhost:7700/instances \
  -H "Authorization: Bearer $TOKEN"
```

### Get Instance Details (includes live ports)

```bash
curl http://localhost:7700/instances/agent-a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN"
```

### SSH into an Instance

```bash
# Get SSH connection info
curl http://localhost:7700/instances/agent-a1b2c3d4/ssh \
  -H "Authorization: Bearer $TOKEN"
# Returns: {"host":"1.2.3.4","port":28432,"user":"agent"}

ssh -p 28432 agent@1.2.3.4
```

### Stop / Start / Restart

```bash
curl -X POST http://localhost:7700/instances/agent-a1b2c3d4/stop \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:7700/instances/agent-a1b2c3d4/start \
  -H "Authorization: Bearer $TOKEN"
```

### Delete an Instance

```bash
curl -X DELETE http://localhost:7700/instances/agent-a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN"
```

### Proxy to Agent Gateway

```bash
# Proxies to the agent's internal gateway (port 3000 inside container)
curl http://localhost:7700/gateway/agent-a1b2c3d4/v1/status \
  -H "Authorization: Bearer $TOKEN"
```

### User & Token Management (Admin)

```bash
# Create a user
curl -X POST http://localhost:7700/users \
  -H "Authorization: Bearer $CRABSHACK_ADMIN_SECRET" \
  -d '{"id": "alice", "name": "Alice"}'

# Create an API token for that user
curl -X POST http://localhost:7700/tokens \
  -H "Authorization: Bearer $CRABSHACK_ADMIN_SECRET" \
  -d '{"user_id": "alice", "label": "dev"}'
# Returns: {"token":"<uuid>", ...}
```

### Backups

```bash
# Trigger a backup
curl -X POST http://localhost:7700/instances/agent-a1b2c3d4/backup \
  -H "Authorization: Bearer $TOKEN"

# Restore from latest snapshot
curl -X POST http://localhost:7700/instances/agent-a1b2c3d4/restore/latest \
  -H "Authorization: Bearer $TOKEN"
```

## Subdomain Routing (UI)

When `CRABSHACK_UI_ZONE` is set (e.g. `agents.example.com`):

| Host | Routes to |
|------|-----------|
| `agents.example.com` | User portal |
| `admin.agents.example.com` | Admin dashboard |
| `api.agents.example.com` | API passthrough |
| `agent-a1b2c3d4.agents.example.com` | Proxy to agent's gateway (HTTP + WebSocket) |

## Security Model

- **Auth**: Timing-safe token comparison (`crypto.timingSafeEqual`), per-session cookies for UI
- **Ownership**: Non-admin users can only access their own instances across all endpoints
- **Nomad ACLs**: All API calls include `X-Nomad-Token` when `NOMAD_TOKEN` is set
- **Secrets**: API keys and tokens stored in Nomad Variables, never in job HCL definitions
- **Template safety**: HCL values are sanitized (escape `"`, `$`, newlines) to prevent injection
- **Service type allowlist**: Only known template names accepted, preventing path traversal
- **Egress control**: Per-container iptables chains allow only DNS/HTTP/HTTPS outbound
- **Container isolation**: Sysbox provides unprivileged user namespace mapping for DinD workloads

## Observability

The platform includes a full observability stack deployed as Nomad system jobs:

- **Prometheus** — scrapes Nomad metrics + iptables drop counters
- **Grafana** — dashboards for cluster and per-agent metrics
- **Loki** — centralized log aggregation
- **Promtail** — ships Docker container logs to Loki

## Testing

```bash
bun test
```

92 tests across 13 files covering auth, routing, template rendering, instance lifecycle, and SSE event formats.

## Project Structure

```
src/                    API server (Bun.js + TypeScript)
  auth/                 Bearer token extraction + timing-safe comparison
  db/                   SQLite schema + query modules
  nomad/                Nomad HTTP API client + Variables API
  proxy/                HTTP + WebSocket reverse proxy to agents
  routes/               Route handlers (instances, users, backups, nodes)
  stream/               SSE deploy event streaming

ui/src/                 UI server + React frontend
  host-routing.ts       Subdomain-based multi-tenant routing
  proxy.ts              API + agent proxy layer
  ws-bridge.ts          WebSocket bridge for terminal access

nomad/
  templates/            HCL job templates (rendered per-instance)
  jobs/                 System jobs (prometheus, grafana, loki, backups)
  scripts/              Egress control + backup/restore shell scripts
  configs/              Prometheus, Grafana, Promtail configs

infra/
  scripts/
    deploy.sh           Single-node full deploy (Docker+Sysbox+Nomad+API+UI)
    gcloud-firewall.sh  GCP firewall rules setup
    bootstrap-server.sh Multi-node server bootstrap
    bootstrap-client.sh Multi-node client bootstrap
    bootstrap-local-dev.sh  Minimal dev setup (Nomad only)
    validate-cluster.sh Health checks
  configs/              Nomad Docker plugin config
```
