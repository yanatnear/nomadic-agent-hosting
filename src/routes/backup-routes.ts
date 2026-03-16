import type { Database } from "bun:sqlite";
import type { CrabshackConfig } from "../config.ts";
import { getInstance } from "../db/instance-queries.ts";
import { renderJobTemplate } from "../template-render.ts";
import { submitJob, getJobAllocs } from "../nomad/nomad-client.ts";

export async function handleCreateBackup(
  db: Database,
  config: CrabshackConfig,
  instanceName: string,
): Promise<Response> {
  const inst = getInstance(db, instanceName);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  if (!inst.nomad_job_id) {
    return Response.json({ error: "Instance has no Nomad job" }, { status: 400 });
  }

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ error: "No running allocation" }, { status: 400 });
  }

  const hcl = renderJobTemplate("backup", {
    INSTANCE_NAME: instanceName,
    TARGET_NODE_ID: (running as any).NodeID,
    AGENT_ALLOC_ID: (running as any).ID,
    S3_ENDPOINT: process.env.CRABSHACK_S3_ENDPOINT || "s3.amazonaws.com",
    S3_BUCKET: process.env.CRABSHACK_S3_BUCKET || "crabshack-backups",
    S3_ACCESS_KEY: process.env.CRABSHACK_S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.CRABSHACK_S3_SECRET_KEY || "",
    RESTIC_PASSWORD: process.env.CRABSHACK_RESTIC_PASSWORD || "changeme",
  });

  const evalId = await submitJob(config.nomadAddr, hcl);
  return Response.json({ evalId, message: "Backup job submitted" });
}

export async function handleRestoreBackup(
  db: Database,
  config: CrabshackConfig,
  instanceName: string,
): Promise<Response> {
  const inst = getInstance(db, instanceName);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  const hcl = renderJobTemplate("restore", {
    INSTANCE_NAME: instanceName,
    TARGET_NODE_ID: "any",
    S3_ENDPOINT: process.env.CRABSHACK_S3_ENDPOINT || "s3.amazonaws.com",
    S3_BUCKET: process.env.CRABSHACK_S3_BUCKET || "crabshack-backups",
    S3_ACCESS_KEY: process.env.CRABSHACK_S3_ACCESS_KEY || "",
    S3_SECRET_KEY: process.env.CRABSHACK_S3_SECRET_KEY || "",
    RESTIC_PASSWORD: process.env.CRABSHACK_RESTIC_PASSWORD || "changeme",
    RESTORE_PATH: `/var/lib/nomad/alloc/${instanceName}/agent/local`,
    SNAPSHOT_ID: "latest",
  });

  const evalId = await submitJob(config.nomadAddr, hcl);
  return Response.json({ evalId, message: "Restore job submitted" });
}
