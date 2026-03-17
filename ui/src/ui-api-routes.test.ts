import { test, expect } from "bun:test";
import { handleUiApi, type UiApiDeps } from "./ui-api-routes.ts";

const deps: UiApiDeps = {
  zone: "agents.example.com",
  cfApiToken: "test-cf-token",
  cfToken: "test-tunnel-token",
  secret: "test-secret",
};

test("handleUiApi /api/ui/config returns zone and flags", async () => {
  const req = new Request("http://localhost/api/ui/config");
  const res = await handleUiApi(req, "/api/ui/config", deps);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    zone: "agents.example.com",
    hasTunnel: true,
    hasCfApi: true,
  });
});

test("handleUiApi /api/ui/config with empty tokens", async () => {
  const emptyDeps: UiApiDeps = { zone: "", cfApiToken: "", cfToken: "", secret: "" };
  const req = new Request("http://localhost/api/ui/config");
  const res = await handleUiApi(req, "/api/ui/config", emptyDeps);
  const body = await res.json();
  expect(body.hasTunnel).toBe(false);
  expect(body.hasCfApi).toBe(false);
});

test("handleUiApi /api/ui/tunnel returns tunnel status", async () => {
  const req = new Request("http://localhost/api/ui/tunnel");
  const res = await handleUiApi(req, "/api/ui/tunnel", deps);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("running");
});

test("handleUiApi /api/auth/check returns 401 when not authed", async () => {
  const req = new Request("http://localhost/api/auth/check");
  const res = await handleUiApi(req, "/api/auth/check", deps);
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body).toEqual({ ok: false });
});

test("handleUiApi unknown path returns 404", async () => {
  const req = new Request("http://localhost/api/ui/unknown");
  const res = await handleUiApi(req, "/api/ui/unknown", deps);
  expect(res.status).toBe(404);
});

test("handleUiApi /api/ui/cf/setup without cfApiToken returns 400", async () => {
  const noCfDeps: UiApiDeps = { zone: "test.com", cfApiToken: "", cfToken: "", secret: "" };
  const req = new Request("http://localhost/api/ui/cf/setup", { method: "POST" });
  const res = await handleUiApi(req, "/api/ui/cf/setup", noCfDeps);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toContain("CF API token");
});
