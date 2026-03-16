import type { Database } from "bun:sqlite";

export interface UserRow {
  id: string;
  name: string;
  created_at: string;
  is_admin: number;
}

export interface TokenRow {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string | null;
  label: string;
}

export function createUser(
  db: Database,
  id: string,
  name: string,
  isAdmin: boolean
): void {
  db.run(
    "INSERT INTO users (id, name, is_admin) VALUES (?, ?, ?)",
    [id, name, isAdmin ? 1 : 0]
  );
}

export function getUser(db: Database, id: string): UserRow | null {
  return db.query<UserRow, [string]>(
    "SELECT * FROM users WHERE id = ?"
  ).get(id);
}

export function listUsers(db: Database): UserRow[] {
  return db.query<UserRow, []>(
    "SELECT * FROM users ORDER BY created_at ASC"
  ).all();
}

export function createAccessToken(
  db: Database,
  token: string,
  userId: string,
  label: string
): void {
  db.run(
    "INSERT INTO access_tokens (token, user_id, label) VALUES (?, ?, ?)",
    [token, userId, label]
  );
}

export function validateToken(
  db: Database,
  token: string
): { userId: string; isAdmin: boolean } | null {
  const row = db.query<{ user_id: string; is_admin: number; expires_at: string | null }, [string]>(
    `SELECT at.user_id, u.is_admin, at.expires_at
     FROM access_tokens at
     JOIN users u ON u.id = at.user_id
     WHERE at.token = ?`
  ).get(token);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return { userId: row.user_id, isAdmin: row.is_admin === 1 };
}
