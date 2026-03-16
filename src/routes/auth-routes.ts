import type { Database } from "bun:sqlite";
import { extractBearerToken, isAdminToken } from "../auth/bearer-auth.ts";
import { validateToken } from "../db/user-queries.ts";

export interface AuthResult {
  userId: string;
  isAdmin: boolean;
}

export function authenticateRequest(
  headers: Headers,
  db: Database,
  adminSecret: string,
): AuthResult | null {
  const token = extractBearerToken(headers);
  if (!token) return null;

  if (isAdminToken(token, adminSecret)) {
    return { userId: "admin", isAdmin: true };
  }

  return validateToken(db, token);
}
