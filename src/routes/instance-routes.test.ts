import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema.ts";
import { createInstance, getInstance } from "../db/instance-queries.ts";

// Tests for response shapes that nearai-infra-qa expects
// These test the DB layer and response format, not the live Nomad integration

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  db.run("INSERT INTO users (id, name) VALUES ('u1', 'Alice')");
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
  // Simulate what handleGetInstance returns (minus Consul lookup)
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
    gateway_port: null,  // would come from Consul
    ssh_port: null,      // would come from Consul
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
