import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";
import {
  createUser,
  getUser,
  listUsers,
  createAccessToken,
  validateToken,
} from "./user-queries.ts";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

test("createUser and getUser round-trip", () => {
  createUser(db, "u1", "Alice", false);
  const user = getUser(db, "u1");
  expect(user).not.toBeNull();
  expect(user!.name).toBe("Alice");
  expect(user!.is_admin).toBe(0);
});

test("createUser admin flag", () => {
  createUser(db, "admin1", "Admin", true);
  const user = getUser(db, "admin1");
  expect(user!.is_admin).toBe(1);
});

test("getUser returns null for unknown id", () => {
  expect(getUser(db, "no-such-user")).toBeNull();
});

test("listUsers returns all users ordered by created_at", () => {
  createUser(db, "u1", "Alice", false);
  createUser(db, "u2", "Bob", false);
  const users = listUsers(db);
  expect(users.length).toBe(2);
  expect(users.map(u => u.id)).toContain("u1");
  expect(users.map(u => u.id)).toContain("u2");
});

test("createAccessToken and validateToken round-trip", () => {
  createUser(db, "u1", "Alice", false);
  createAccessToken(db, "tok-abc", "u1", "test token");
  const result = validateToken(db, "tok-abc");
  expect(result).not.toBeNull();
  expect(result!.userId).toBe("u1");
  expect(result!.isAdmin).toBe(false);
});

test("validateToken returns null for unknown token", () => {
  expect(validateToken(db, "does-not-exist")).toBeNull();
});

test("validateToken reflects admin status", () => {
  createUser(db, "admin1", "Admin", true);
  createAccessToken(db, "tok-admin", "admin1", "admin token");
  const result = validateToken(db, "tok-admin");
  expect(result!.isAdmin).toBe(true);
});

test("validateToken returns null for expired token", () => {
  createUser(db, "u1", "Alice", false);
  db.run(
    "INSERT INTO access_tokens (token, user_id, label, expires_at) VALUES (?, ?, ?, ?)",
    ["tok-expired", "u1", "expired", "2000-01-01T00:00:00Z"]
  );
  expect(validateToken(db, "tok-expired")).toBeNull();
});
