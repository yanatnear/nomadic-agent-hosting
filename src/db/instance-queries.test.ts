import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";
import {
  createInstance,
  getInstance,
  listInstances,
  listAllInstances,
  deleteInstance,
  updateInstanceStatus,
  updateInstanceNodeId,
} from "./instance-queries.ts";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  db.run("INSERT INTO users (id, name) VALUES ('u1', 'Alice')");
});

function makeParams(overrides: Record<string, string> = {}) {
  return {
    name: overrides.name ?? "inst-1",
    userId: overrides.userId ?? "u1",
    serviceType: overrides.serviceType ?? "ironclaw-dind",
    nomadJobId: overrides.nomadJobId ?? "job-abc",
    image: overrides.image ?? "ironclaw-nearai-worker:local",
    memLimit: overrides.memLimit ?? "4g",
    cpus: overrides.cpus ?? "1",
    storageSize: overrides.storageSize ?? "10G",
    sshPubkey: overrides.sshPubkey ?? "ssh-ed25519 AAAA",
    token: overrides.token ?? "tok-123",
  };
}

test("createInstance stores a row with all fields", () => {
  createInstance(db, makeParams());
  const row = getInstance(db, "inst-1");
  expect(row).not.toBeNull();
  expect(row!.name).toBe("inst-1");
  expect(row!.user_id).toBe("u1");
  expect(row!.service_type).toBe("ironclaw-dind");
  expect(row!.nomad_job_id).toBe("job-abc");
  expect(row!.status).toBe("creating");
  expect(row!.image).toBe("ironclaw-nearai-worker:local");
  expect(row!.mem_limit).toBe("4g");
  expect(row!.cpus).toBe("1");
  expect(row!.storage_size).toBe("10G");
  expect(row!.ssh_pubkey).toBe("ssh-ed25519 AAAA");
  expect(row!.token).toBe("tok-123");
});

test("getInstance returns null for unknown name", () => {
  expect(getInstance(db, "no-such-instance")).toBeNull();
});

test("listInstances returns only the user's instances", () => {
  db.run("INSERT INTO users (id, name) VALUES ('u2', 'Bob')");
  createInstance(db, makeParams({ name: "inst-a", nomadJobId: "j1" }));
  createInstance(db, makeParams({ name: "inst-b", nomadJobId: "j2" }));
  createInstance(db, makeParams({ name: "inst-c", userId: "u2", nomadJobId: "j3" }));
  const rows = listInstances(db, "u1");
  expect(rows.length).toBe(2);
  expect(rows.map(r => r.name).sort()).toEqual(["inst-a", "inst-b"]);
});

test("listAllInstances returns all instances regardless of user", () => {
  db.run("INSERT INTO users (id, name) VALUES ('u2', 'Bob')");
  createInstance(db, makeParams({ name: "inst-a", nomadJobId: "j1" }));
  createInstance(db, makeParams({ name: "inst-c", userId: "u2", nomadJobId: "j3" }));
  const rows = listAllInstances(db);
  expect(rows.length).toBe(2);
});

test("deleteInstance removes the row", () => {
  createInstance(db, makeParams({ name: "inst-del", nomadJobId: "job-del" }));
  deleteInstance(db, "inst-del");
  expect(getInstance(db, "inst-del")).toBeNull();
});

test("updateInstanceStatus changes status", () => {
  createInstance(db, makeParams({ name: "inst-upd", nomadJobId: "job-upd" }));
  updateInstanceStatus(db, "inst-upd", "running");
  const row = getInstance(db, "inst-upd");
  expect(row!.status).toBe("running");
});

test("updateInstanceNodeId sets node_id", () => {
  createInstance(db, makeParams({ name: "inst-node", nomadJobId: "job-n" }));
  updateInstanceNodeId(db, "inst-node", "node-xyz");
  const row = getInstance(db, "inst-node");
  expect(row!.node_id).toBe("node-xyz");
});
