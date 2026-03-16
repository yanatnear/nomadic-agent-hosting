import { test, expect } from "bun:test";
import { extractAgent, isApiHost, isAdminHost, isUserHost, jsonResponse } from "./host-routing.ts";

const ZONE = "agents.example.com";

// extractAgent
test("extractAgent returns agent name from subdomain", () => {
  expect(extractAgent("myagent.agents.example.com", ZONE)).toBe("myagent");
});

test("extractAgent returns null for bare zone", () => {
  expect(extractAgent("agents.example.com", ZONE)).toBeNull();
});

test("extractAgent returns null for admin subdomain", () => {
  expect(extractAgent("admin.agents.example.com", ZONE)).toBeNull();
});

test("extractAgent returns null for api subdomain", () => {
  expect(extractAgent("api.agents.example.com", ZONE)).toBeNull();
});

test("extractAgent returns null when no zone configured", () => {
  expect(extractAgent("myagent.agents.example.com", "")).toBeNull();
});

test("extractAgent strips port from host", () => {
  expect(extractAgent("myagent.agents.example.com:3000", ZONE)).toBe("myagent");
});

test("extractAgent returns null for unrelated host", () => {
  expect(extractAgent("other.example.com", ZONE)).toBeNull();
});

// isApiHost
test("isApiHost returns true for api subdomain", () => {
  expect(isApiHost("api.agents.example.com", ZONE)).toBe(true);
});

test("isApiHost returns false for bare zone", () => {
  expect(isApiHost("agents.example.com", ZONE)).toBe(false);
});

test("isApiHost returns false when no zone", () => {
  expect(isApiHost("api.agents.example.com", "")).toBe(false);
});

// isAdminHost
test("isAdminHost returns true for admin subdomain", () => {
  expect(isAdminHost("admin.agents.example.com", ZONE)).toBe(true);
});

test("isAdminHost returns true for localhost", () => {
  expect(isAdminHost("localhost:3000", ZONE)).toBe(true);
});

test("isAdminHost returns true for 127.0.0.1", () => {
  expect(isAdminHost("127.0.0.1:3000", ZONE)).toBe(true);
});

test("isAdminHost returns true when no zone (all hosts are admin)", () => {
  expect(isAdminHost("anything.example.com", "")).toBe(true);
});

test("isAdminHost returns false for agent subdomain", () => {
  expect(isAdminHost("myagent.agents.example.com", ZONE)).toBe(false);
});

// isUserHost
test("isUserHost returns true for bare zone", () => {
  expect(isUserHost("agents.example.com", ZONE)).toBe(true);
});

test("isUserHost returns false for subdomain", () => {
  expect(isUserHost("myagent.agents.example.com", ZONE)).toBe(false);
});

test("isUserHost returns false when no zone", () => {
  expect(isUserHost("agents.example.com", "")).toBe(false);
});

// jsonResponse
test("jsonResponse returns JSON with correct status and content-type", async () => {
  const res = jsonResponse({ error: "not found" }, 404);
  expect(res.status).toBe(404);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  const body = await res.json();
  expect(body).toEqual({ error: "not found" });
});
