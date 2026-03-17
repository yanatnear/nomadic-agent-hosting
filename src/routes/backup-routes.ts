import type { Database } from "bun:sqlite";
import type { CrabshackConfig } from "../config.ts";
import type { AuthResult } from "./auth-routes.ts";
import { getInstance } from "../db/instance-queries.ts";
import { renderJobTemplate } from "../template-render.ts";
import { submitJob, getJobAllocs, putNomadVariable, deleteNomadVariable } from "../nomad/nomad-client.ts";

const INSTANCE_NAME_RE = /^agent-[a-f0-9]{8}$/;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required env var ${name} is not set`);
  return val;
}

export async function handleCreateBackup(
  db: Database,
  config: CrabshackConfig,
  instanceName: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, instanceName);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  if (!auth.isAdmin && inst.user_id !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!inst.nomad_job_id) {
    return Response.json({ error: "Instance has no Nomad job" }, { status: 400 });
  }
  if (!INSTANCE_NAME_RE.test(instanceName)) {
    return Response.json({ error: "Invalid instance name" }, { status: 400 });
  }

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ error: "No running allocation" }, { status: 400 });
  }

  const backupJobName = `backup-${instanceName}`;

  // Store backup secrets in Nomad Variables — job reads them via template block
  await putNomadVariable(config.nomadAddr, `crabshack/${backupJobName}`, {
    RESTIC_PASSWORD: requireEnv("CRABSHACK_RESTIC_PASSWORD"),
    S3_ACCESS_KEY: process.env.CRABSHACK_S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.CRABSHACK_S3_SECRET_KEY || "",
  }, config.nomadToken);

  const hcl = renderJobTemplate("backup", {
    INSTANCE_NAME: instanceName,
    TARGET_NODE_ID: (running as any).NodeID,
    AGENT_ALLOC_ID: (running as any).ID,
    S3_ENDPOINT: process.env.CRABSHACK_S3_ENDPOINT || "s3.amazonaws.com",
    S3_BUCKET: process.env.CRABSHACK_S3_BUCKET || "crabshack-backups",
    BACKUP_PATH: `/var/lib/nomad/alloc/${(running as any).ID}/agent/local`,
  });

  const evalId = await submitJob(config.nomadAddr, hcl, config.nomadToken);
  return Response.json({ evalId, message: "Backup job submitted" });
}

export async function handleRestoreBackup(
  db: Database,
  config: CrabshackConfig,
  instanceName: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, instanceName);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  if (!auth.isAdmin && inst.user_id !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!INSTANCE_NAME_RE.test(instanceName)) {
    return Response.json({ error: "Invalid instance name" }, { status: 400 });
  }

  const restoreJobName = `restore-${instanceName}`;

  // Store restore secrets in Nomad Variables
  await putNomadVariable(config.nomadAddr, `crabshack/${restoreJobName}`, {
    RESTIC_PASSWORD: requireEnv("CRABSHACK_RESTIC_PASSWORD"),
    S3_ACCESS_KEY: process.env.CRABSHACK_S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.CRABSHACK_S3_SECRET_KEY || "",
  }, config.nomadToken);

  const hcl = renderJobTemplate("restore", {
    INSTANCE_NAME: instanceName,
    TARGET_NODE_ID: "any",
    S3_ENDPOINT: process.env.CRABSHACK_S3_ENDPOINT || "s3.amazonaws.com",
    S3_BUCKET: process.env.CRABSHACK_S3_BUCKET || "crabshack-backups",
    RESTORE_PATH: `/var/lib/nomad/alloc/${instanceName}/agent/local`,
    SNAPSHOT_ID: "latest",
  });

  const evalId = await submitJob(config.nomadAddr, hcl, config.nomadToken);
  return Response.json({ evalId, message: "Restore job submitted" });
}
