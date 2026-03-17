import type { Database } from "bun:sqlite";
import type { CrabshackConfig } from "../config.ts";
import type { AuthResult } from "./auth-routes.ts";
import type { InstanceRow } from "../db/instance-queries.ts";
import { createInstance, getInstance, listInstances, listAllInstances, deleteInstance, updateInstanceStatus } from "../db/instance-queries.ts";
import { renderJobTemplate } from "../template-render.ts";
import { submitJob, stopJob, startJob, purgeJob, getJob, getJobAllocs, getAllocLogs, getAllocStats, parseAllocPorts, listNomadNodes, getNomadNode, resolveAllocEndpoint, putNomadVariable, deleteNomadVariable } from "../nomad/nomad-client.ts";
import { streamDeployEvents } from "../stream/deploy-stream.ts";

/** Verify the caller owns the instance or is admin. Returns error Response or null if OK. */
function checkOwnership(inst: { user_id: string }, auth: AuthResult): Response | null {
  if (!auth.isAdmin && inst.user_id !== auth.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Shorthand to get nomad addr+token from config. */
function n(config: CrabshackConfig): [string, string] {
  return [config.nomadAddr, config.nomadToken];
}

/** Resolve the public IP for an internal address by checking Nomad node meta. */
async function resolvePublicIp(config: CrabshackConfig, internalIp: string): Promise<string> {
  try {
    const nodes = await listNomadNodes(...n(config));
    for (const node of nodes) {
      if ((node as any).Address === internalIp) {
        const detail = await getNomadNode(config.nomadAddr, (node as any).ID, config.nomadToken);
        const pub = (detail.Meta as Record<string, string>)?.public_ip;
        if (pub) return pub;
      }
    }
  } catch {}
  return internalIp;
}

function sseStream(
  emitFn: (send: (event: string, data: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      function send(event: string, data: Record<string, unknown>): void {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      try {
        await emitFn(send);
      } catch (err) {
        send("error", { message: String(err) });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

interface RuntimeInstanceView {
  row: InstanceRow;
  status: string;
  nodeId: string | null;
}

function serializeInstanceView(view: RuntimeInstanceView): Record<string, unknown> {
  const { row, status, nodeId } = view;
  return {
    name: row.name,
    status,
    service_type: row.service_type,
    image: row.image,
    mem_limit: row.mem_limit,
    cpus: row.cpus,
    storage_size: row.storage_size,
    node_id: nodeId,
    created_at: row.created_at,
  };
}

async function reconcileInstanceState(
  db: Database,
  config: CrabshackConfig,
  row: InstanceRow,
) : Promise<RuntimeInstanceView | null> {
  if (!row.nomad_job_id) {
    return {
      row,
      status: row.status,
      nodeId: null,
    };
  }

  const job = await getJob(config.nomadAddr, row.nomad_job_id, config.nomadToken);
  if (!job) {
    deleteInstance(db, row.name);
    return null;
  }

  const allocs = await getJobAllocs(config.nomadAddr, row.nomad_job_id, config.nomadToken);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  const latestAlloc = running ?? allocs[0];
  const status = running ? "running" : ((job as any).Stop ? "stopped" : row.status);
  const nodeId = ((latestAlloc as any)?.NodeID as string | undefined) ?? null;

  return { row, status, nodeId };
}

export async function handleCreateInstance(
  req: Request,
  db: Database,
  config: CrabshackConfig,
  userId: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const required = ["service_type", "image", "mem_limit", "cpus", "nearai_api_key", "nearai_api_url"] as const;
  const missing = required.filter(k => !body[k] || typeof body[k] !== "string");
  if (missing.length > 0) {
    return Response.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
  }

  const name = `agent-${crypto.randomUUID().slice(0, 8)}`;
  const memMb = parseMemMb(body.mem_limit as string);
  const cpuMhz = Math.round(parseFloat(body.cpus as string) * 1000);
  const instanceToken = crypto.randomUUID();

  const serviceType = body.service_type as string;
  const image = body.image as string;
  const memLimit = body.mem_limit as string;
  const cpus = body.cpus as string;
  const nearaiApiKey = body.nearai_api_key as string;
  const nearaiApiUrl = body.nearai_api_url as string;
  const sshPubkey = (body.ssh_pubkey as string) || "";
  const storageSize = (body.storage_size as string) || "";

  const jobId = `agent-${name}`;

  // Store secrets in Nomad Variables — jobs read them via template blocks
  await putNomadVariable(config.nomadAddr, `crabshack/${name}`, {
    NEARAI_API_KEY: nearaiApiKey,
    INSTANCE_TOKEN: instanceToken,
  }, config.nomadToken);

  const hcl = renderJobTemplate(serviceType, {
    INSTANCE_NAME: name,
    IMAGE: image,
    MEM_MB: String(memMb),
    CPU_MHZ: String(cpuMhz),
    NEARAI_API_URL: nearaiApiUrl,
    SSH_PUBKEY: sshPubkey,
  });

  const evalId = await submitJob(config.nomadAddr, hcl, config.nomadToken);
  createInstance(db, {
    name,
    userId,
    serviceType,
    nomadJobId: jobId,
    image,
    memLimit,
    cpus,
    storageSize,
    sshPubkey,
    token: instanceToken,
  });

  return sseStream(async (send) => {
    send("created", { name });
    for await (const event of streamDeployEvents(config.nomadAddr, evalId, config.nomadToken)) {
      if (event.status === "running") {
        updateInstanceStatus(db, name, "running");
        send("ready", { name });
        return;
      }
      if (event.status === "error") {
        updateInstanceStatus(db, name, "error");
        send("error", { message: event.message });
        return;
      }
      send(event.status, { message: event.message });
    }
  });
}

export async function handleGetInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  const view = await reconcileInstanceState(db, config, inst);
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });

  const jobId = `agent-${name}`;
  const ep = await resolveAllocEndpoint(config.nomadAddr, jobId, "gateway", config.nomadToken);
  const sshEp = await resolveAllocEndpoint(config.nomadAddr, jobId, "ssh", config.nomadToken);

  return Response.json({
    name: view.row.name,
    status: view.status,
    service_type: view.row.service_type,
    image: view.row.image,
    mem_limit: view.row.mem_limit,
    cpus: view.row.cpus,
    storage_size: view.row.storage_size,
    node_id: view.nodeId,
    token: view.row.token,
    gateway_address: ep?.address ?? null,
    gateway_port: ep?.port ?? null,
    ssh_address: sshEp?.address ?? null,
    ssh_port: sshEp?.port ?? null,
    created_at: view.row.created_at,
  });
}

export async function handleListInstances(
  db: Database,
  config: CrabshackConfig,
  userId: string,
  isAdmin: boolean,
): Promise<Response> {
  const rows = isAdmin ? listAllInstances(db) : listInstances(db, userId);
  const reconciled = await Promise.all(rows.map((row) => reconcileInstanceState(db, config, row)));
  return Response.json(reconciled.filter((row): row is RuntimeInstanceView => row !== null).map(serializeInstanceView));
}

export async function handleDeleteInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const pre = getInstance(db, name);
  if (!pre) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(pre, auth);
  if (deny) return deny;

  return sseStream(async (send) => {
    const inst = getInstance(db, name);
    if (!inst) {
      send("error", { message: "Not found" });
      return;
    }
    if (inst.nomad_job_id) {
      await purgeJob(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
    }
    // Clean up Nomad Variable holding this instance's secrets
    await deleteNomadVariable(config.nomadAddr, `crabshack/${name}`, config.nomadToken).catch(() => {});
    deleteInstance(db, name);
    send("deleted", { name });
  });
}

export async function handleStopInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  return sseStream(async (send) => {
    if (inst.nomad_job_id) {
      await stopJob(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
    }
    updateInstanceStatus(db, name, "stopped");
    send("stopped", { name });
  });
}

export async function handleStartInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  return sseStream(async (send) => {
    if (!inst.nomad_job_id) {
      send("error", { message: "Instance has no Nomad job" });
      return;
    }
    const evalId = await startJob(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
    updateInstanceStatus(db, name, "creating");
    for await (const event of streamDeployEvents(config.nomadAddr, evalId, config.nomadToken)) {
      if (event.status === "running") {
        updateInstanceStatus(db, name, "running");
        send("ready", { name });
        return;
      }
      if (event.status === "error") {
        updateInstanceStatus(db, name, "error");
        send("error", { message: event.message });
        return;
      }
      send(event.status, { message: event.message });
    }
  });
}

export async function handleRestartInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  return sseStream(async (send) => {
    if (!inst.nomad_job_id) {
      send("error", { message: "Instance has no Nomad job" });
      return;
    }
    await stopJob(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
    // Brief pause for the stop to propagate
    await new Promise(r => setTimeout(r, 2000));
    const evalId = await startJob(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
    updateInstanceStatus(db, name, "creating");
    for await (const event of streamDeployEvents(config.nomadAddr, evalId, config.nomadToken)) {
      if (event.status === "running") {
        updateInstanceStatus(db, name, "running");
        send("ready", { name });
        return;
      }
      if (event.status === "error") {
        updateInstanceStatus(db, name, "error");
        send("error", { message: event.message });
        return;
      }
      send(event.status, { message: event.message });
    }
  });
}

export async function handleGetInstanceSsh(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  const sshEp = await resolveAllocEndpoint(config.nomadAddr, `agent-${name}`, "ssh", config.nomadToken);
  if (!sshEp) {
    return Response.json({ error: "SSH endpoint not available" }, { status: 404 });
  }

  const host = await resolvePublicIp(config, sshEp.address);
  return Response.json({
    host,
    port: sshEp.port,
    user: "agent",
  });
}

export async function handleGetInstanceLogs(
  db: Database,
  config: CrabshackConfig,
  name: string,
  tail: number,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ name, logs: "" });
  }

  const allocId = (running as any).ID as string;
  const taskName = "agent";
  const stderr = await getAllocLogs(config.nomadAddr, allocId, taskName, "stderr", tail, config.nomadToken);
  const stdout = await getAllocLogs(config.nomadAddr, allocId, taskName, "stdout", tail, config.nomadToken);
  const logs = stdout + stderr;

  return Response.json({ name, logs });
}

export async function handleGetInstanceStats(
  db: Database,
  config: CrabshackConfig,
  name: string,
  auth: AuthResult,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });
  const deny = checkOwnership(inst, auth);
  if (deny) return deny;

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id, config.nomadToken);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ name, stats: {} });
  }

  const allocId = (running as any).ID as string;
  const rawStats = await getAllocStats(config.nomadAddr, allocId, config.nomadToken);

  return Response.json({ name, stats: rawStats });
}

function parseMemMb(mem: string): number {
  const lower = mem.toLowerCase();
  if (lower.endsWith("g")) return parseFloat(lower) * 1024;
  if (lower.endsWith("m")) return parseFloat(lower);
  return parseFloat(lower);
}
