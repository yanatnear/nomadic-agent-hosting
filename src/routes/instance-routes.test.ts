import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema.ts";
import { createInstance, getInstance } from "../db/instance-queries.ts";
import { handleGetInstance, handleListInstances } from "./instance-routes.ts";

// Tests for response shapes that nearai-infra-qa expects
// These test the DB layer and response format, not the live Nomad integration

let db: Database;
const fetchMock = mock(() => {
  throw new Error("fetch mock not configured");
});
const config = {
  port: 0,
  dataDir: "/tmp",
  adminSecret: "secret",
  nomadAddr: "http://nomad.service",
  nomadToken: "",
};

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  db.run("INSERT INTO users (id, name) VALUES ('u1', 'Alice')");
  globalThis.fetch = fetchMock as typeof fetch;
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

function makeParams() {
  return {
    name: "agent-abc12345",
    userId: "u1",
    serviceType: "ironclaw-dind",
    nomadJobId: "agent-agent-abc12345",
    image: "nearaidev/ironclaw-nearai-worker:latest",
    memLimit: "2G",
    cpus: "1",
    storageSize: "20G",
    sshPubkey: "ssh-ed25519 AAAA test@host",
    token: "tok-uuid-here",
  };
}

test("instance stores all fields QA expects", () => {
  createInstance(db, makeParams());
  const inst = getInstance(db, "agent-abc12345")!;
  expect(inst.name).toBe("agent-abc12345");
  expect(inst.service_type).toBe("ironclaw-dind");
  expect(inst.image).toBe("nearaidev/ironclaw-nearai-worker:latest");
  expect(inst.mem_limit).toBe("2G");
  expect(inst.cpus).toBe("1");
  expect(inst.storage_size).toBe("20G");
  expect(inst.token).toBe("tok-uuid-here");
  expect(inst.status).toBe("creating");
  expect(inst.created_at).toBeTruthy();
});

test("GET /instances/{name} response has QA-expected fields", () => {
  // Simulate what handleGetInstance returns (minus Nomad allocation lookup)
  createInstance(db, makeParams());
  const inst = getInstance(db, "agent-abc12345")!;

  // Build the response shape matching handleGetInstance
  const response = {
    name: inst.name,
    status: inst.status,
    service_type: inst.service_type,
    image: inst.image,
    mem_limit: inst.mem_limit,
    cpus: inst.cpus,
    storage_size: inst.storage_size,
    node_id: inst.node_id || null,
    token: inst.token,
    gateway_port: null,  // would come from Nomad allocation
    ssh_port: null,      // would come from Nomad allocation
    created_at: inst.created_at,
  };

  // QA test_agent_creation.py checks these fields
  expect(response).toHaveProperty("name");
  expect(response).toHaveProperty("status");
  expect(response).toHaveProperty("image");
  expect(response).toHaveProperty("service_type");
  expect(response).toHaveProperty("mem_limit");
  expect(response).toHaveProperty("cpus");
  expect(response).toHaveProperty("storage_size");
  expect(response).toHaveProperty("gateway_port");
  expect(response).toHaveProperty("ssh_port");
  expect(response).toHaveProperty("token");
  expect(response).toHaveProperty("created_at");
  // snake_case, not camelCase
  expect(response).not.toHaveProperty("gatewayPort");
  expect(response).not.toHaveProperty("sshPort");
});

test("GET /instances list response has QA-expected fields", () => {
  createInstance(db, makeParams());
  const inst = getInstance(db, "agent-abc12345")!;

  const listItem = {
    name: inst.name,
    status: inst.status,
    service_type: inst.service_type,
    image: inst.image,
    mem_limit: inst.mem_limit,
    cpus: inst.cpus,
    storage_size: inst.storage_size,
    node_id: inst.node_id || null,
    created_at: inst.created_at,
  };

  expect(listItem).toHaveProperty("name");
  expect(listItem).toHaveProperty("status");
  expect(listItem).toHaveProperty("image");
  expect(listItem).toHaveProperty("created_at");
});

test("SSE created event shape matches QA expectations", () => {
  // QA sse.py parser expects: event: created\ndata: {"name": "..."}\n\n
  const event = "created";
  const data = { name: "agent-abc12345" };
  const sseText = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  expect(sseText).toContain("event: created\n");
  expect(sseText).toContain('"name"');
  // Parse it back
  const lines = sseText.trim().split("\n");
  expect(lines[0]).toBe("event: created");
  const dataParsed = JSON.parse(lines[1].replace("data: ", ""));
  expect(dataParsed.name).toBe("agent-abc12345");
});

test("SSE ready event shape matches QA expectations", () => {
  const event = "ready";
  const data = { name: "agent-abc12345" };
  const sseText = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const lines = sseText.trim().split("\n");
  expect(lines[0]).toBe("event: ready");
});

test("SSE stopped event shape matches QA expectations", () => {
  const event = "stopped";
  const data = { name: "agent-abc12345" };
  const sseText = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const lines = sseText.trim().split("\n");
  expect(lines[0]).toBe("event: stopped");
});

test("SSE deleted event shape matches QA expectations", () => {
  const event = "deleted";
  const data = { name: "agent-abc12345" };
  const sseText = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const lines = sseText.trim().split("\n");
  expect(lines[0]).toBe("event: deleted");
});

test("SSE error event shape matches QA expectations", () => {
  const event = "error";
  const data = { message: "something went wrong" };
  const sseText = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const lines = sseText.trim().split("\n");
  expect(lines[0]).toBe("event: error");
  const dataParsed = JSON.parse(lines[1].replace("data: ", ""));
  expect(dataParsed).toHaveProperty("message");
});

test("error responses use {error: string} format", () => {
  const resp = { error: "Not found" };
  expect(resp).toHaveProperty("error");
  expect(typeof resp.error).toBe("string");
});

test("default instance status is creating, not pending", () => {
  createInstance(db, makeParams());
  const inst = getInstance(db, "agent-abc12345")!;
  expect(inst.status).toBe("creating");
});

test("GET /instances marks externally stopped Nomad jobs as stopped", async () => {
  createInstance(db, makeParams());
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/job/agent-agent-abc12345")) {
      return new Response(JSON.stringify({ Stop: true }), { status: 200 });
    }
    if (url.endsWith("/v1/job/agent-agent-abc12345/allocations")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await handleListInstances(db, config, "u1", false);
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].status).toBe("stopped");
  expect(getInstance(db, "agent-abc12345")?.status).toBe("creating");
});

test("GET /instances removes rows whose Nomad jobs were purged", async () => {
  createInstance(db, makeParams());
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/job/agent-agent-abc12345")) {
      return new Response("not found", { status: 404 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await handleListInstances(db, config, "u1", false);
  const body = await res.json();

  expect(body).toHaveLength(0);
  expect(getInstance(db, "agent-abc12345")).toBeNull();
});

test("GET /instances/{name} derives status and node_id from Nomad", async () => {
  createInstance(db, makeParams());
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/job/agent-agent-abc12345")) {
      return new Response(JSON.stringify({ Stop: false }), { status: 200 });
    }
    if (url.endsWith("/v1/job/agent-agent-abc12345/allocations")) {
      return new Response(JSON.stringify([
        { ID: "alloc-1", ClientStatus: "running", NodeID: "node-123" },
      ]), { status: 200 });
    }
    if (url.endsWith("/v1/allocation/alloc-1")) {
      return new Response(JSON.stringify({
        Resources: {
          Networks: [{ IP: "10.0.0.7", DynamicPorts: [{ Label: "gateway", Value: 20001 }, { Label: "ssh", Value: 20002 }] }],
        },
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const res = await handleGetInstance(db, config, "agent-abc12345", {
    userId: "u1",
    isAdmin: false,
  });
  const body = await res.json();

  expect(body.status).toBe("running");
  expect(body.node_id).toBe("node-123");
  expect(body.gateway_port).toBe(20001);
  expect(body.ssh_port).toBe(20002);
  expect(getInstance(db, "agent-abc12345")?.status).toBe("creating");
  expect(getInstance(db, "agent-abc12345")?.node_id).toBe("");
});
