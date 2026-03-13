# Thin API (Bun.js → Nomad)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new Bun.js API server that translates user requests into Nomad job operations, replacing the current 4,200 LOC monolith with ~1,200-1,500 LOC.

**Architecture:** Bun.serve() HTTP server with routes for instance CRUD, auth, backups, and gateway proxy. All container lifecycle operations delegate to the Nomad HTTP API. Instance metadata and user data stay in SQLite. WebSocket proxy uses Consul service discovery to route to the correct node/port.

**Tech Stack:** Bun.js, bun:sqlite, Nomad HTTP API, Consul HTTP API

**Depends on:** Plan 02 (Nomad job templates + renderer)

---

## File Structure

```
agent-hosting-v2/
  src/
    main.ts                        # Server entrypoint
    config.ts                      # Env var loading, validation
    debug.ts                       # Debug logging (CRABSHACK_DEBUG)
    nomad/
      nomad-client.ts              # HTTP client for Nomad API
      nomad-client.test.ts
    consul/
      consul-client.ts             # HTTP client for Consul API (service discovery)
      consul-client.test.ts
    db/
      schema.ts                    # SQLite schema (users, instances, access_tokens)
      schema.test.ts
      instance-queries.ts          # CRUD for instance metadata
      instance-queries.test.ts
      user-queries.ts              # CRUD for users + tokens
      user-queries.test.ts
    auth/
      bearer-auth.ts               # Bearer token middleware
      bearer-auth.test.ts
    routes/
      instance-routes.ts           # POST/GET/DELETE /instances
      instance-routes.test.ts
      auth-routes.ts               # Login, token management
      user-routes.ts               # User CRUD
      backup-routes.ts             # Trigger backup/restore (dispatches Nomad batch jobs)
      health-routes.ts             # GET /health (API health, not instance health)
    proxy/
      gateway-proxy.ts             # HTTP reverse proxy to agent gateway
      ws-handler.ts                # WebSocket proxy to agent containers
      resolve-alloc.ts             # Consul lookup: instance name -> node:port
      resolve-alloc.test.ts
    stream/
      deploy-stream.ts             # SSE stream of Nomad event stream for deploy progress
      deploy-stream.test.ts
    template-render.ts             # (from Plan 02)
    template-render.test.ts        # (from Plan 02)
```

---

## Chunk 1: Core Infrastructure

### Task 1: Config and debug modules

**Files:**
- Create: `src/config.ts`
- Create: `src/debug.ts`

- [ ] **Step 1: Write config.ts**

```ts
export interface CrabshackConfig {
  adminSecret: string;
  port: number;
  dataDir: string;
  nomadAddr: string;
  consulAddr: string;
}

export function loadConfig(): CrabshackConfig {
  const adminSecret = process.env.CRABSHACK_ADMIN_SECRET;
  if (!adminSecret) throw new Error("CRABSHACK_ADMIN_SECRET is required");
  return {
    adminSecret,
    port: parseInt(process.env.CRABSHACK_PORT || "7700", 10),
    dataDir: process.env.CRABSHACK_DATA_DIR || "./crabshack-data",
    nomadAddr: process.env.NOMAD_ADDR || "http://127.0.0.1:4646",
    consulAddr: process.env.CONSUL_HTTP_ADDR || "http://127.0.0.1:8500",
  };
}
```

- [ ] **Step 2: Write debug.ts**

```ts
const DEBUG = process.env.CRABSHACK_DEBUG === "1";

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log("[debug]", ...args);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/config.ts src/debug.ts
git commit -m "feat: config and debug modules for thin API"
```

---

### Task 2: SQLite schema

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/schema.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";

test("initSchema creates tables", () => {
  const db = new Database(":memory:");
  initSchema(db);
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const names = tables.map(t => t.name);
  expect(names).toContain("users");
  expect(names).toContain("instances");
  expect(names).toContain("access_tokens");
});

test("initSchema is idempotent", () => {
  const db = new Database(":memory:");
  initSchema(db);
  initSchema(db); // should not throw
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `bun test src/db/schema.test.ts`

- [ ] **Step 3: Write implementation**

```ts
import { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      label TEXT
    );

    CREATE TABLE IF NOT EXISTS instances (
      name TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      service_type TEXT NOT NULL,
      nomad_job_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      error_message TEXT,
      meta TEXT DEFAULT '{}'
    );
  `);
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `bun test src/db/schema.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts
git commit -m "feat: SQLite schema for users, instances, access_tokens"
```

---

### Task 3: Nomad HTTP client

**Files:**
- Create: `src/nomad/nomad-client.ts`
- Create: `src/nomad/nomad-client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from "bun:test";
import { buildJobSubmitUrl, buildJobStopUrl, parseAllocPorts } from "./nomad-client.ts";

test("buildJobSubmitUrl", () => {
  expect(buildJobSubmitUrl("http://localhost:4646"))
    .toBe("http://localhost:4646/v1/jobs");
});

test("buildJobStopUrl", () => {
  expect(buildJobStopUrl("http://localhost:4646", "agent-test"))
    .toBe("http://localhost:4646/v1/job/agent-test?purge=true");
});

test("parseAllocPorts extracts gateway and ssh ports", () => {
  const alloc = {
    Resources: {
      Networks: [{
        DynamicPorts: [
          { Label: "gateway", Value: 25000 },
          { Label: "ssh", Value: 25001 },
        ],
        IP: "10.0.1.5",
      }],
    },
    NodeID: "node-abc",
  };
  const ports = parseAllocPorts(alloc);
  expect(ports.gatewayPort).toBe(25000);
  expect(ports.sshPort).toBe(25001);
  expect(ports.nodeIp).toBe("10.0.1.5");
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write implementation**

```ts
import { debugLog } from "../debug.ts";

export function buildJobSubmitUrl(nomadAddr: string): string {
  return `${nomadAddr}/v1/jobs`;
}

export function buildJobStopUrl(nomadAddr: string, jobId: string): string {
  return `${nomadAddr}/v1/job/${jobId}?purge=true`;
}

export interface AllocPorts {
  gatewayPort: number;
  sshPort: number;
  nodeIp: string;
}

export function parseAllocPorts(alloc: Record<string, unknown>): AllocPorts {
  const networks = (alloc as any).Resources?.Networks;
  if (!networks || networks.length === 0) throw new Error("No networks in allocation");
  const net = networks[0];
  const ports = net.DynamicPorts as { Label: string; Value: number }[];
  const gw = ports.find(p => p.Label === "gateway");
  const ssh = ports.find(p => p.Label === "ssh");
  if (!gw) throw new Error("No gateway port in allocation");
  if (!ssh) throw new Error("No ssh port in allocation");
  return { gatewayPort: gw.Value, sshPort: ssh.Value, nodeIp: net.IP };
}

export async function submitJob(nomadAddr: string, jobHcl: string): Promise<string> {
  const parseResp = await fetch(`${nomadAddr}/v1/jobs/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ JobHCL: jobHcl, Canonicalize: true }),
  });
  if (!parseResp.ok) throw new Error(`Nomad parse failed: ${await parseResp.text()}`);
  const job = await parseResp.json();

  const submitResp = await fetch(buildJobSubmitUrl(nomadAddr), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Job: job }),
  });
  if (!submitResp.ok) throw new Error(`Nomad submit failed: ${await submitResp.text()}`);
  const result = await submitResp.json();
  debugLog("Job submitted:", result.EvalID);
  return result.EvalID;
}

export async function stopJob(nomadAddr: string, jobId: string): Promise<void> {
  const resp = await fetch(buildJobStopUrl(nomadAddr, jobId), { method: "DELETE" });
  if (!resp.ok) throw new Error(`Nomad stop failed: ${await resp.text()}`);
}

export async function getJobAllocs(nomadAddr: string, jobId: string): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}/allocations`);
  if (!resp.ok) throw new Error(`Nomad allocs query failed: ${await resp.text()}`);
  return resp.json();
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/nomad/nomad-client.ts src/nomad/nomad-client.test.ts
git commit -m "feat: Nomad HTTP client for job submit, stop, alloc queries"
```

---

### Task 4: Consul service discovery client

**Files:**
- Create: `src/consul/consul-client.ts`
- Create: `src/consul/consul-client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from "bun:test";
import { buildServiceUrl, parseServiceEndpoint } from "./consul-client.ts";

test("buildServiceUrl", () => {
  expect(buildServiceUrl("http://localhost:8500", "agent-my-agent"))
    .toBe("http://localhost:8500/v1/catalog/service/agent-my-agent");
});

test("parseServiceEndpoint extracts address and port", () => {
  const entry = {
    ServiceAddress: "10.0.1.5",
    ServicePort: 25000,
    Node: "client-1",
    Address: "10.0.1.5",
  };
  const ep = parseServiceEndpoint(entry);
  expect(ep.address).toBe("10.0.1.5");
  expect(ep.port).toBe(25000);
});

test("parseServiceEndpoint falls back to Node address", () => {
  const entry = {
    ServiceAddress: "",
    ServicePort: 25000,
    Node: "client-1",
    Address: "10.0.1.5",
  };
  const ep = parseServiceEndpoint(entry);
  expect(ep.address).toBe("10.0.1.5");
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write implementation**

```ts
export function buildServiceUrl(consulAddr: string, serviceName: string): string {
  return `${consulAddr}/v1/catalog/service/${serviceName}`;
}

export interface ServiceEndpoint {
  address: string;
  port: number;
}

export function parseServiceEndpoint(entry: Record<string, unknown>): ServiceEndpoint {
  const svcAddr = entry.ServiceAddress as string;
  const nodeAddr = entry.Address as string;
  return {
    address: svcAddr || nodeAddr,
    port: entry.ServicePort as number,
  };
}

export async function resolveService(consulAddr: string, serviceName: string): Promise<ServiceEndpoint | null> {
  const resp = await fetch(buildServiceUrl(consulAddr, serviceName));
  if (!resp.ok) return null;
  const entries = await resp.json() as Record<string, unknown>[];
  if (entries.length === 0) return null;
  return parseServiceEndpoint(entries[0]);
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/consul/consul-client.ts src/consul/consul-client.test.ts
git commit -m "feat: Consul service discovery client"
```

---

## Chunk 2: Routes

### Task 5: Auth middleware

**Files:**
- Create: `src/auth/bearer-auth.ts`
- Create: `src/auth/bearer-auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from "bun:test";
import { extractBearerToken, isAdminToken } from "./bearer-auth.ts";

test("extractBearerToken from Authorization header", () => {
  const headers = new Headers({ Authorization: "Bearer secret123" });
  expect(extractBearerToken(headers)).toBe("secret123");
});

test("extractBearerToken returns null for missing header", () => {
  expect(extractBearerToken(new Headers())).toBeNull();
});

test("isAdminToken checks against admin secret", () => {
  expect(isAdminToken("secret", "secret")).toBe(true);
  expect(isAdminToken("wrong", "secret")).toBe(false);
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write implementation**

```ts
export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function isAdminToken(token: string, adminSecret: string): boolean {
  return token === adminSecret;
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/auth/bearer-auth.ts src/auth/bearer-auth.test.ts
git commit -m "feat: bearer token auth middleware"
```

---

### Task 6: Instance queries + routes

**Files:**
- Create: `src/db/instance-queries.ts`
- Create: `src/db/instance-queries.test.ts`
- Create: `src/routes/instance-routes.ts`

- [ ] **Step 1: Write instance-queries test**

```ts
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";
import { createInstance, getInstance, listInstances, deleteInstance, updateInstanceStatus } from "./instance-queries.ts";

function testDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  db.exec("INSERT INTO users (id, name) VALUES ('u1', 'Test User')");
  return db;
}

test("createInstance and getInstance", () => {
  const db = testDb();
  createInstance(db, "agent-1", "u1", "ironclaw-dind", "nomad-job-1");
  const inst = getInstance(db, "agent-1");
  expect(inst).not.toBeNull();
  expect(inst!.name).toBe("agent-1");
  expect(inst!.service_type).toBe("ironclaw-dind");
  expect(inst!.nomad_job_id).toBe("nomad-job-1");
  expect(inst!.status).toBe("pending");
});

test("listInstances filters by user", () => {
  const db = testDb();
  db.exec("INSERT INTO users (id, name) VALUES ('u2', 'Other')");
  createInstance(db, "a1", "u1", "openclaw", "j1");
  createInstance(db, "a2", "u2", "openclaw", "j2");
  const u1Instances = listInstances(db, "u1");
  expect(u1Instances.length).toBe(1);
  expect(u1Instances[0].name).toBe("a1");
});

test("deleteInstance removes row", () => {
  const db = testDb();
  createInstance(db, "a1", "u1", "openclaw", "j1");
  deleteInstance(db, "a1");
  expect(getInstance(db, "a1")).toBeNull();
});

test("updateInstanceStatus", () => {
  const db = testDb();
  createInstance(db, "a1", "u1", "openclaw", "j1");
  updateInstanceStatus(db, "a1", "running");
  expect(getInstance(db, "a1")!.status).toBe("running");
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write instance-queries implementation**

```ts
import { Database } from "bun:sqlite";

export interface InstanceRow {
  name: string;
  user_id: string;
  service_type: string;
  nomad_job_id: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
  meta: string;
}

export function createInstance(db: Database, name: string, userId: string, serviceType: string, nomadJobId: string): void {
  db.exec(
    "INSERT INTO instances (name, user_id, service_type, nomad_job_id) VALUES (?, ?, ?, ?)",
    [name, userId, serviceType, nomadJobId],
  );
}

export function getInstance(db: Database, name: string): InstanceRow | null {
  return db.query("SELECT * FROM instances WHERE name = ?").get(name) as InstanceRow | null;
}

export function listInstances(db: Database, userId: string): InstanceRow[] {
  return db.query("SELECT * FROM instances WHERE user_id = ? ORDER BY created_at DESC").all(userId) as InstanceRow[];
}

export function deleteInstance(db: Database, name: string): void {
  db.exec("DELETE FROM instances WHERE name = ?", [name]);
}

export function updateInstanceStatus(db: Database, name: string, status: string): void {
  db.exec("UPDATE instances SET status = ? WHERE name = ?", [status, name]);
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Write instance-routes.ts**

Wires together template rendering, Nomad job submission, and SQLite metadata:

- `POST /instances` — validate request, render HCL template, submit to Nomad, store metadata, stream deploy progress via SSE
- `GET /instances` — list user's instances from SQLite
- `GET /instances/:name` — read from SQLite + Consul (for live port info)
- `DELETE /instances/:name` — stop Nomad job, delete from SQLite

- [ ] **Step 6: Commit**

```bash
git add src/db/instance-queries.ts src/db/instance-queries.test.ts src/routes/instance-routes.ts
git commit -m "feat: instance CRUD routes backed by Nomad"
```

---

### Task 7: Deploy progress streaming

**Files:**
- Create: `src/stream/deploy-stream.ts`
- Create: `src/stream/deploy-stream.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, expect } from "bun:test";
import { formatAllocEvent } from "./deploy-stream.ts";

test("formatAllocEvent maps pending state", () => {
  const event = formatAllocEvent({ ClientStatus: "pending", TaskStates: {} });
  expect(event.status).toBe("pending");
  expect(event.message).toContain("Waiting");
});

test("formatAllocEvent maps running state", () => {
  const event = formatAllocEvent({
    ClientStatus: "running",
    TaskStates: { agent: { State: "running" } },
  });
  expect(event.status).toBe("running");
});

test("formatAllocEvent maps failed state with error", () => {
  const event = formatAllocEvent({
    ClientStatus: "failed",
    TaskStates: { agent: { State: "dead", Events: [{ DisplayMessage: "OOM killed" }] } },
  });
  expect(event.status).toBe("error");
  expect(event.message).toContain("OOM");
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write implementation**

```ts
export interface DeployEvent {
  status: string;
  message: string;
}

export function formatAllocEvent(alloc: Record<string, unknown>): DeployEvent {
  const clientStatus = alloc.ClientStatus as string;
  const taskStates = alloc.TaskStates as Record<string, { State: string; Events?: { DisplayMessage: string }[] }> | null;

  if (clientStatus === "pending") {
    return { status: "pending", message: "Waiting for scheduling..." };
  }
  if (clientStatus === "running") {
    return { status: "running", message: "Container is running" };
  }
  if (clientStatus === "failed") {
    let errorMsg = "Container failed";
    if (taskStates) {
      for (const [, state] of Object.entries(taskStates)) {
        if (state.State === "dead" && state.Events) {
          const lastEvent = state.Events[state.Events.length - 1];
          if (lastEvent?.DisplayMessage) errorMsg = lastEvent.DisplayMessage;
        }
      }
    }
    return { status: "error", message: errorMsg };
  }
  return { status: clientStatus, message: `Allocation status: ${clientStatus}` };
}

export async function* streamDeployEvents(nomadAddr: string, evalId: string): AsyncGenerator<DeployEvent> {
  let allocId: string | null = null;

  for (let i = 0; i < 30; i++) {
    const resp = await fetch(`${nomadAddr}/v1/evaluation/${evalId}/allocations`);
    if (resp.ok) {
      const allocs = await resp.json() as { ID: string }[];
      if (allocs.length > 0) { allocId = allocs[0].ID; break; }
    }
    yield { status: "pending", message: "Waiting for scheduling..." };
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!allocId) { yield { status: "error", message: "No allocation created after 30s" }; return; }

  for (let i = 0; i < 120; i++) {
    const resp = await fetch(`${nomadAddr}/v1/allocation/${allocId}`);
    if (!resp.ok) { yield { status: "error", message: "Failed to query allocation" }; return; }
    const alloc = await resp.json();
    const event = formatAllocEvent(alloc);
    yield event;
    if (event.status === "running" || event.status === "error") return;
    await new Promise(r => setTimeout(r, 1000));
  }
  yield { status: "error", message: "Deploy timed out after 120s" };
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/stream/deploy-stream.ts src/stream/deploy-stream.test.ts
git commit -m "feat: deploy progress streaming via Nomad allocation polling"
```

---

### Task 8: Gateway/WebSocket proxy with Consul discovery

**Files:**
- Create: `src/proxy/resolve-alloc.ts`
- Create: `src/proxy/resolve-alloc.test.ts`
- Create: `src/proxy/gateway-proxy.ts`
- Create: `src/proxy/ws-handler.ts`

- [ ] **Step 1: Write resolve-alloc test**

```ts
import { test, expect } from "bun:test";
import { buildGatewayTarget } from "./resolve-alloc.ts";

test("buildGatewayTarget constructs URL from service endpoint", () => {
  const target = buildGatewayTarget({ address: "10.0.1.5", port: 25000 }, "/some/path");
  expect(target).toBe("http://10.0.1.5:25000/some/path");
});
```

- [ ] **Step 2: Run test — expect fail**

- [ ] **Step 3: Write resolve-alloc implementation**

```ts
import type { ServiceEndpoint } from "../consul/consul-client.ts";

export function buildGatewayTarget(ep: ServiceEndpoint, path: string): string {
  return `http://${ep.address}:${ep.port}${path}`;
}
```

- [ ] **Step 4: Write gateway-proxy.ts and ws-handler.ts**

Forward HTTP and WebSocket requests to agent containers. Use `resolveService()` from Consul client to map instance name to node:port. Follow the same proxy pattern as v1 but replace SQLite lookup with Consul query.

- [ ] **Step 5: Run test — expect pass**

- [ ] **Step 6: Commit**

```bash
git add src/proxy/
git commit -m "feat: gateway and WebSocket proxy with Consul service discovery"
```

---

## Chunk 3: Server Entrypoint + Integration

### Task 9: Main server

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Write the server entrypoint**

Wire all routes into Bun.serve(). Loads config, initializes SQLite, and dispatches requests:

```ts
import { loadConfig } from "./config.ts";
import { Database } from "bun:sqlite";
import { initSchema } from "./db/schema.ts";

const config = loadConfig();
const db = new Database(`${config.dataDir}/crabshack.db`);
initSchema(db);

Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    // Route matching + auth middleware + handler dispatch
  },
});

console.log(`CrabShack API v2 listening on :${config.port}`);
```

- [ ] **Step 2: Smoke test**

Run: `CRABSHACK_ADMIN_SECRET=test bun run src/main.ts`
Expected: `CrabShack API v2 listening on :7700`

Test: `curl -s http://localhost:7700/health`
Expected: 200 OK

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main server entrypoint wiring all routes"
```

---

### Task 10: Integration test — full instance lifecycle

- [ ] **Step 1: Write integration test**

Create `integration/instance-lifecycle.test.ts` that creates, gets, and deletes an instance through the real API + Nomad.

- [ ] **Step 2: Run against live server + Nomad**

Run: `CRABSHACK_ADMIN_SECRET=test bun test integration/instance-lifecycle.test.ts`

- [ ] **Step 3: Commit**

```bash
git add integration/
git commit -m "test: integration test for full instance lifecycle"
```
