# Ingress + UI (Cloudflare, Subdomain Routing, User Portal)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Cloudflare tunnel integration, subdomain routing, and user-facing portal from v1, adapting them to use Consul service discovery instead of SQLite lookups.

**Architecture:** The UI server handles subdomain-based routing (`<agent>.<zone>`), Cloudflare tunnel management, and serves the React user portal. Gateway/WebSocket proxy resolves agent locations via Consul. Admin views are removed (replaced by Nomad UI + Grafana).

**Tech Stack:** Bun.js, React, Cloudflare API, Consul HTTP API

**Depends on:** Plan 03 (thin API with Consul client)

---

## File Structure

```
agent-hosting-v2/
  ui/
    src/
      main.ts                      # UI server entrypoint
      ui-server.ts                 # Bun.serve() with host-based routing
      host-routing.ts              # Subdomain parsing and dispatch
      proxy.ts                     # HTTP proxy to agent containers
      ws-bridge.ts                 # WebSocket bridge
      cf-api.ts                    # Cloudflare API (tunnel, DNS records)
      tunnel.ts                    # cloudflared process management
      api.ts                       # Client-side API helpers
      api-types.ts                 # Shared types
      frontend.tsx                 # React app entry (user portal)
      LoginView.tsx
      CreateAgentForm.tsx
      InstanceList.tsx
      InstanceDetail.tsx
      AgentBackups.tsx
      UserList.tsx
      PasskeyList.tsx
    package.json
    tsconfig.json
```

---

### Task 1: Port host-routing and proxy from v1

**Files:**
- Create: `ui/src/host-routing.ts`
- Create: `ui/src/proxy.ts`
- Create: `ui/src/ws-bridge.ts`

- [ ] **Step 1: Copy and adapt host-routing.ts from v1**

The core logic stays the same: parse the `Host` header to extract `<agent-name>.<zone>`, then proxy to the agent's gateway. The change: instead of looking up the agent's port in SQLite via the v1 API, query Consul for `agent-<name>` service to get node:port.

- [ ] **Step 2: Copy and adapt proxy.ts from v1**

Replace the target resolution (was: API call to get node/port, now: Consul service query).

- [ ] **Step 3: Copy and adapt ws-bridge.ts from v1**

Same change — Consul for target resolution.

- [ ] **Step 4: Commit**

```bash
git add ui/src/host-routing.ts ui/src/proxy.ts ui/src/ws-bridge.ts
git commit -m "feat: port subdomain routing and proxy from v1, use Consul discovery"
```

---

### Task 2: Port Cloudflare integration from v1

**Files:**
- Create: `ui/src/cf-api.ts`
- Create: `ui/src/tunnel.ts`

- [ ] **Step 1: Copy cf-api.ts from v1 (unchanged)**

Cloudflare API calls for tunnel creation, DNS CNAME records, and ACM certificate checks are not affected by the Nomad migration.

- [ ] **Step 2: Copy tunnel.ts from v1 (unchanged)**

cloudflared process management is independent of the backend.

- [ ] **Step 3: Commit**

```bash
git add ui/src/cf-api.ts ui/src/tunnel.ts
git commit -m "feat: port Cloudflare tunnel integration from v1"
```

---

### Task 3: Slim down React frontend

**Files:**
- Create: `ui/src/frontend.tsx` and kept components

- [ ] **Step 1: Copy user-facing components from v1**

Keep: `LoginView.tsx`, `CreateAgentForm.tsx`, `InstanceList.tsx`, `InstanceDetail.tsx`, `AgentBackups.tsx`, `UserList.tsx`, `PasskeyList.tsx`

Do NOT copy: `NodeList.tsx`, `NodeDetail.tsx`, `DiagCheckList.tsx`, `DnsDiag.tsx`, `EventLog.tsx`, `RegisterNodeModal.tsx`, `AgentLogs.tsx`, `MissingImagesWarning.tsx`, `BackupList.tsx`

- [ ] **Step 2: Update frontend.tsx routing to remove admin views**

Remove routes for node management, diagnostics, event log. Keep user portal routes only.

- [ ] **Step 3: Update API calls in components**

Components that call the v1 API need updating:
- Instance creation now returns Nomad job ID instead of compose container info
- Instance detail now includes Nomad-assigned ports (from Consul) instead of static port assignments
- Backup triggers call the new backup routes

- [ ] **Step 4: Commit**

```bash
git add ui/src/
git commit -m "feat: slimmed user portal frontend (admin views removed)"
```

---

### Task 4: UI server entrypoint

**Files:**
- Create: `ui/src/main.ts`
- Create: `ui/src/ui-server.ts`

- [ ] **Step 1: Write UI server**

Bun.serve() with:
- Host-based routing (subdomain → agent proxy)
- Static file serving for the React frontend
- API proxy to the thin API backend
- Cloudflare tunnel startup

- [ ] **Step 2: Smoke test**

```bash
cd ui && CRABSHACK_ADMIN_SECRET=test CRABSHACK_API_URL=http://localhost:7700 bun run src/main.ts
```

Expected: UI available at http://localhost:3000

- [ ] **Step 3: Commit**

```bash
git add ui/src/main.ts ui/src/ui-server.ts
git commit -m "feat: UI server with host routing and Cloudflare tunnel"
```

---

### Task 5: End-to-end test

- [ ] **Step 1: Start thin API + UI server + Nomad**
- [ ] **Step 2: Create an instance via the UI**
- [ ] **Step 3: Verify subdomain routing works (agent reachable via `<name>.<zone>`)**
- [ ] **Step 4: Verify WebSocket proxy works**
- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "test: validated ingress + UI end-to-end"
```
