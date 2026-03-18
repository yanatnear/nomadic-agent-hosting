import { Database } from "bun:sqlite";
import { loadConfig } from "./config.ts";
import { initSchema } from "./db/schema.ts";
import { authenticateRequest } from "./routes/auth-routes.ts";
import { handleHealth } from "./routes/health-routes.ts";
import {
  handleCreateInstance, handleGetInstance, handleListInstances,
  handleDeleteInstance, handleStopInstance, handleStartInstance,
  handleRestartInstance, handleGetInstanceSsh, handleGetInstanceLogs,
  handleGetInstanceStats,
} from "./routes/instance-routes.ts";
import { handleListUsers, handleGetUser, handleCreateUser, handleCreateToken } from "./routes/user-routes.ts";
import { handleCreateBackup, handleRestoreBackup } from "./routes/backup-routes.ts";
import { handleListNodes } from "./routes/node-routes.ts";
import { proxyToGateway } from "./proxy/gateway-proxy.ts";
import { getInstance } from "./db/instance-queries.ts";
import { putNomadVariable } from "./nomad/nomad-client.ts";
import { mkdirSync } from "fs";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const db = new Database(`${config.dataDir}/crabshack.db`);
initSchema(db);

// Seed shared backup config into Nomad Variables for the periodic backup job
if (process.env.CRABSHACK_RESTIC_PASSWORD) {
  putNomadVariable(config.nomadAddr, "crabshack/backup-config", {
    S3_ENDPOINT: process.env.CRABSHACK_S3_ENDPOINT || "s3.amazonaws.com",
    S3_BUCKET: process.env.CRABSHACK_S3_BUCKET || "crabshack-backups",
    S3_ACCESS_KEY: process.env.CRABSHACK_S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.CRABSHACK_S3_SECRET_KEY || "",
    RESTIC_PASSWORD: process.env.CRABSHACK_RESTIC_PASSWORD,
  }, config.nomadToken).catch((err) => {
    console.error("Failed to seed backup config variable:", err.message);
  });
}

function jsonError(msg: string, status: number): Response {
  return Response.json({ error: msg }, { status });
}

function matchRoute(method: string, path: string, pattern: string): string[] | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: string[] = [];
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params.push(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

Bun.serve({
  port: config.port,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (path === "/health" && method === "GET") return handleHealth();

    const auth = authenticateRequest(req.headers, db, config.adminSecret);
    if (!auth) return jsonError("Unauthorized", 401);

    // Nodes (admin only)
    if (path === "/nodes" && method === "GET") {
      return handleListNodes(config, auth);
    }

    // Instances — collection
    if (path === "/instances" && method === "GET") {
      return handleListInstances(db, config, auth.userId, auth.isAdmin);
    }
    if (path === "/instances" && method === "POST") {
      return handleCreateInstance(req, db, config, auth.userId);
    }

    let params: string[] | null;

    // Instances — single
    params = matchRoute(method, path, "/instances/:name");
    if (params) {
      if (method === "GET") return handleGetInstance(db, config, params[0], auth);
      if (method === "DELETE") return handleDeleteInstance(db, config, params[0], auth);
    }

    // Instance lifecycle
    params = matchRoute(method, path, "/instances/:name/stop");
    if (params && method === "POST") return handleStopInstance(db, config, params[0], auth);

    params = matchRoute(method, path, "/instances/:name/start");
    if (params && method === "POST") return handleStartInstance(db, config, params[0], auth);

    params = matchRoute(method, path, "/instances/:name/restart");
    if (params && method === "POST") return handleRestartInstance(db, config, params[0], auth);

    // Instance info
    params = matchRoute(method, path, "/instances/:name/ssh");
    if (params && method === "GET") return handleGetInstanceSsh(db, config, params[0], auth);

    params = matchRoute(method, path, "/instances/:name/logs");
    if (params && method === "GET") {
      const tail = parseInt(url.searchParams.get("tail") ?? "100", 10);
      return handleGetInstanceLogs(db, config, params[0], tail, auth);
    }

    params = matchRoute(method, path, "/instances/:name/stats");
    if (params && method === "GET") return handleGetInstanceStats(db, config, params[0], auth);

    // Backups
    params = matchRoute(method, path, "/instances/:name/backup");
    if (params && method === "POST") return handleCreateBackup(db, config, params[0], auth);

    params = matchRoute(method, path, "/instances/:name/restore/:backupId");
    if (params && method === "POST") return handleRestoreBackup(db, config, params[0], auth);

    // Users
    if (path === "/users" && method === "GET" && auth.isAdmin) return handleListUsers(db);
    if (path === "/users" && method === "POST" && auth.isAdmin) return handleCreateUser(req, db);

    params = matchRoute(method, path, "/users/:id");
    if (params && method === "GET") return handleGetUser(db, params[0], auth);

    if (path === "/tokens" && method === "POST" && auth.isAdmin) return handleCreateToken(req, db);

    // Gateway proxy for /gateway/:name/* — verify ownership before proxying
    if (path.startsWith("/gateway/")) {
      const rest = path.slice("/gateway/".length);
      const slashIdx = rest.indexOf("/");
      const instanceName = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const inst = getInstance(db, instanceName);
      if (!inst) return jsonError("Instance not found", 404);
      if (!auth.isAdmin && inst.user_id !== auth.userId) {
        return jsonError("Forbidden", 403);
      }
      return proxyToGateway(req, config.nomadAddr, instanceName, config.nomadToken);
    }

    return jsonError("Not found", 404);
  },
});

console.log(`CrabShack API v2 listening on :${config.port}`);
