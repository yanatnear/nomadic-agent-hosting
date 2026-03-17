import type { Database } from "bun:sqlite";
import type { AuthResult } from "./auth-routes.ts";
import { createUser, getUser, listUsers, createAccessToken } from "../db/user-queries.ts";

export function handleListUsers(db: Database): Response {
  const users = listUsers(db);
  return Response.json(users);
}

export function handleGetUser(db: Database, userId: string, auth: AuthResult): Response {
  if (!auth.isAdmin && auth.userId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = getUser(db, userId);
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });
  return Response.json(user);
}

export async function handleCreateUser(req: Request, db: Database): Promise<Response> {
  const body = (await req.json()) as { id: string; name: string; is_admin?: boolean };
  if (!body.id || !body.name) {
    return Response.json({ error: "id and name required" }, { status: 400 });
  }
  const isAdmin = body.is_admin ? 1 : 0;
  createUser(db, body.id, body.name, isAdmin);
  return Response.json({ id: body.id, name: body.name, is_admin: isAdmin });
}

export async function handleCreateToken(req: Request, db: Database): Promise<Response> {
  const body = (await req.json()) as { user_id: string; label: string };
  if (!body.user_id || !body.label) {
    return Response.json({ error: "user_id and label required" }, { status: 400 });
  }
  const token = crypto.randomUUID();
  createAccessToken(db, token, body.user_id, body.label);
  return Response.json({ token, user_id: body.user_id, label: body.label });
}
