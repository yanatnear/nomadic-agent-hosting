import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";

function tableNames(db: Database): string[] {
  const rows = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  return rows.map(r => r.name);
}

test("initSchema creates all three tables", () => {
  const db = new Database(":memory:");
  initSchema(db);
  const tables = tableNames(db);
  expect(tables).toContain("users");
  expect(tables).toContain("access_tokens");
  expect(tables).toContain("instances");
});

test("initSchema is idempotent", () => {
  const db = new Database(":memory:");
  initSchema(db);
  expect(() => initSchema(db)).not.toThrow();
  const tables = tableNames(db);
  expect(tables.filter(t => t === "users").length).toBe(1);
  expect(tables.filter(t => t === "access_tokens").length).toBe(1);
  expect(tables.filter(t => t === "instances").length).toBe(1);
});
