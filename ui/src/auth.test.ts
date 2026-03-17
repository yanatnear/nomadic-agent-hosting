import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { isAuthed, isAdminAuthed, cookieZone, setCookie, setAdminCookie, clearCookie, clearAdminCookie, loginPage } from "./auth.ts";

const SECRET = "test-secret-123";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 32);
}

function reqWithCookie(cookie: string): Request {
  return new Request("http://localhost/", { headers: { cookie } });
}

// isAuthed
test("isAuthed returns true when session cookie matches", () => {
  const hash = hashSecret(SECRET);
  const req = reqWithCookie(`crabshack_session=${hash}`);
  expect(isAuthed(req, SECRET)).toBe(true);
});

test("isAuthed returns false when no cookie", () => {
  const req = new Request("http://localhost/");
  expect(isAuthed(req, SECRET)).toBe(false);
});

test("isAuthed returns false with wrong secret", () => {
  const hash = hashSecret("wrong-secret");
  const req = reqWithCookie(`crabshack_session=${hash}`);
  expect(isAuthed(req, SECRET)).toBe(false);
});

// isAdminAuthed
test("isAdminAuthed returns true when admin cookie matches", () => {
  const hash = hashSecret(SECRET);
  const req = reqWithCookie(`crabshack_admin=${hash}`);
  expect(isAdminAuthed(req, SECRET)).toBe(true);
});

test("isAdminAuthed returns false when only session cookie present", () => {
  const hash = hashSecret(SECRET);
  const req = reqWithCookie(`crabshack_session=${hash}`);
  expect(isAdminAuthed(req, SECRET)).toBe(false);
});

// cookieZone
test("cookieZone returns zone when set", () => {
  const req = new Request("http://example.com/", { headers: { host: "something.com:3000" } });
  expect(cookieZone(req, "agents.example.com")).toBe("agents.example.com");
});

test("cookieZone falls back to host when no zone", () => {
  const req = new Request("http://localhost:3000/", { headers: { host: "localhost:3000" } });
  expect(cookieZone(req, "")).toBe("localhost");
});

// setCookie
test("setCookie includes domain for non-localhost", () => {
  const cookie = setCookie(SECRET, "agents.example.com");
  expect(cookie).toContain("crabshack_session=");
  expect(cookie).toContain("Domain=.agents.example.com");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Path=/");
});

test("setCookie omits domain for localhost", () => {
  const cookie = setCookie(SECRET, "localhost");
  expect(cookie).not.toContain("Domain=");
});

// setAdminCookie
test("setAdminCookie sets crabshack_admin", () => {
  const cookie = setAdminCookie(SECRET, "agents.example.com");
  expect(cookie).toContain("crabshack_admin=");
  expect(cookie).toContain("Domain=.agents.example.com");
});

// clearCookie
test("clearCookie sets Max-Age=0", () => {
  const cookie = clearCookie("agents.example.com");
  expect(cookie).toContain("crabshack_session=deleted");
  expect(cookie).toContain("Max-Age=0");
});

// clearAdminCookie
test("clearAdminCookie sets Max-Age=0", () => {
  const cookie = clearAdminCookie("agents.example.com");
  expect(cookie).toContain("crabshack_admin=deleted");
  expect(cookie).toContain("Max-Age=0");
});

// loginPage
test("loginPage returns HTML with form", async () => {
  const res = loginPage("", "/dashboard");
  expect(res.headers.get("Content-Type")).toBe("text/html");
  const html = await res.text();
  expect(html).toContain("CrabShack");
  expect(html).toContain("/api/auth/login");
  expect(html).toContain("/dashboard");
});

test("loginPage escapes HTML in error message", async () => {
  const res = loginPage("<script>alert(1)</script>", "/");
  const html = await res.text();
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&#60;script&#62;");
});

test("loginPage escapes HTML in redirect", async () => {
  const res = loginPage("", "\"><script>alert(1)</script>");
  const html = await res.text();
  expect(html).not.toContain("\"><script>");
});
