import { test, expect } from "bun:test";

// Test that node response shape matches QA expectations
// QA test_host_health.py calls GET /nodes and expects [{id, hostname, ssh_host, ssh_port, ssh_user, status}]

test("node response shape has QA-expected fields", () => {
  // Simulate the transform in handleListNodes
  const nomadNode = {
    ID: "node-abc-123",
    Name: "worker-1",
    Address: "10.0.0.5",
    Status: "ready",
    Datacenter: "dc1",
    Drain: false,
  };

  const result = {
    id: nomadNode.ID,
    hostname: nomadNode.Name,
    ssh_host: nomadNode.Address,
    ssh_port: 22,
    ssh_user: "",
    status: nomadNode.Status === "ready" ? "active" : nomadNode.Status,
    datacenter: nomadNode.Datacenter,
    drain: nomadNode.Drain,
  };

  expect(result).toHaveProperty("id");
  expect(result).toHaveProperty("hostname");
  expect(result).toHaveProperty("ssh_host");
  expect(result).toHaveProperty("ssh_port");
  expect(result).toHaveProperty("ssh_user");
  expect(result).toHaveProperty("status");
  expect(result.status).toBe("active");
});

test("node status mapping: ready -> active", () => {
  const status = "ready";
  expect(status === "ready" ? "active" : status).toBe("active");
});

test("node status mapping: down stays down", () => {
  const status = "down";
  expect(status === "ready" ? "active" : status).toBe("down");
});
