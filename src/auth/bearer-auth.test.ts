import { test, expect } from "bun:test";
import { extractBearerToken, isAdminToken, safeCompare } from "./bearer-auth.ts";

test("extractBearerToken from Authorization header", () => {
  const headers = new Headers({ Authorization: "Bearer secret123" });
  expect(extractBearerToken(headers)).toBe("secret123");
});

test("extractBearerToken returns null for missing header", () => {
  expect(extractBearerToken(new Headers())).toBeNull();
});

test("extractBearerToken returns null for malformed header", () => {
  const headers = new Headers({ Authorization: "Basic abc" });
  expect(extractBearerToken(headers)).toBeNull();
});

test("isAdminToken checks against admin secret", () => {
  expect(isAdminToken("secret", "secret")).toBe(true);
  expect(isAdminToken("wrong", "secret")).toBe(false);
});

test("isAdminToken rejects different-length strings", () => {
  expect(isAdminToken("short", "longer-secret")).toBe(false);
  expect(isAdminToken("longer-secret", "short")).toBe(false);
});

test("safeCompare is timing-safe", () => {
  expect(safeCompare("abc", "abc")).toBe(true);
  expect(safeCompare("abc", "abd")).toBe(false);
  expect(safeCompare("abc", "ab")).toBe(false);
});
