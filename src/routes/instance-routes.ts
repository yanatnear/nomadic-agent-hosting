import type { Database } from "bun:sqlite";
import type { CrabshackConfig } from "../config.ts";
import { createInstance, getInstance, listInstances, listAllInstances, deleteInstance, updateInstanceStatus, updateInstanceNodeId } from "../db/instance-queries.ts";
import { renderJobTemplate } from "../template-render.ts";
import { submitJob, stopJob, startJob, purgeJob, getJobAllocs, getAllocLogs, getAllocStats, parseAllocPorts } from "../nomad/nomad-client.ts";
import { resolveService } from "../consul/consul-client.ts";
import { streamDeployEvents } from "../stream/deploy-stream.ts";

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

  const hcl = renderJobTemplate(serviceType, {
    INSTANCE_NAME: name,
    IMAGE: image,
    MEM_MB: String(memMb),
    CPU_MHZ: String(cpuMhz),
    NEARAI_API_KEY: nearaiApiKey,
    NEARAI_API_URL: nearaiApiUrl,
    SSH_PUBKEY: sshPubkey,
    INSTANCE_TOKEN: instanceToken,
  });

  const jobId = `agent-${name}`;
  const evalId = await submitJob(config.nomadAddr, hcl);
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
    for await (const event of streamDeployEvents(config.nomadAddr, evalId)) {
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
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  const ep = await resolveService(config.consulAddr, `agent-${name}`);
  const sshEp = await resolveService(config.consulAddr, `agent-${name}-ssh`);

  return Response.json({
    name: inst.name,
    status: inst.status,
    service_type: inst.service_type,
    image: inst.image,
    mem_limit: inst.mem_limit,
    cpus: inst.cpus,
    storage_size: inst.storage_size,
    node_id: inst.node_id || null,
    token: inst.token,
    gateway_port: ep?.port ?? null,
    ssh_port: sshEp?.port ?? null,
    created_at: inst.created_at,
  });
}

export function handleListInstances(db: Database, userId: string, isAdmin: boolean): Response {
  const rows = isAdmin ? listAllInstances(db) : listInstances(db, userId);
  return Response.json(rows.map(r => ({
    name: r.name,
    status: r.status,
    service_type: r.service_type,
    image: r.image,
    mem_limit: r.mem_limit,
    cpus: r.cpus,
    storage_size: r.storage_size,
    node_id: r.node_id || null,
    created_at: r.created_at,
  })));
}

export async function handleDeleteInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
): Promise<Response> {
  return sseStream(async (send) => {
    const inst = getInstance(db, name);
    if (!inst) {
      send("error", { message: "Not found" });
      return;
    }
    if (inst.nomad_job_id) {
      await purgeJob(config.nomadAddr, inst.nomad_job_id);
    }
    deleteInstance(db, name);
    send("deleted", { name });
  });
}

export async function handleStopInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  return sseStream(async (send) => {
    if (inst.nomad_job_id) {
      await stopJob(config.nomadAddr, inst.nomad_job_id);
    }
    updateInstanceStatus(db, name, "stopped");
    send("stopped", { name });
  });
}

export async function handleStartInstance(
  db: Database,
  config: CrabshackConfig,
  name: string,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  return sseStream(async (send) => {
    if (!inst.nomad_job_id) {
      send("error", { message: "Instance has no Nomad job" });
      return;
    }
    const evalId = await startJob(config.nomadAddr, inst.nomad_job_id);
    updateInstanceStatus(db, name, "creating");
    for await (const event of streamDeployEvents(config.nomadAddr, evalId)) {
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
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  return sseStream(async (send) => {
    if (!inst.nomad_job_id) {
      send("error", { message: "Instance has no Nomad job" });
      return;
    }
    await stopJob(config.nomadAddr, inst.nomad_job_id);
    // Brief pause for the stop to propagate
    await new Promise(r => setTimeout(r, 2000));
    const evalId = await startJob(config.nomadAddr, inst.nomad_job_id);
    updateInstanceStatus(db, name, "creating");
    for await (const event of streamDeployEvents(config.nomadAddr, evalId)) {
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
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  const sshEp = await resolveService(config.consulAddr, `agent-${name}-ssh`);
  if (!sshEp) {
    return Response.json({ error: "SSH endpoint not available" }, { status: 404 });
  }

  return Response.json({
    host: sshEp.address,
    port: sshEp.port,
    user: "agent",
  });
}

export async function handleGetInstanceLogs(
  db: Database,
  config: CrabshackConfig,
  name: string,
  tail: number,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ name, logs: "" });
  }

  const allocId = (running as any).ID as string;
  const taskName = "agent";
  const stderr = await getAllocLogs(config.nomadAddr, allocId, taskName, "stderr", tail);
  const stdout = await getAllocLogs(config.nomadAddr, allocId, taskName, "stdout", tail);
  const logs = stdout + stderr;

  return Response.json({ name, logs });
}

export async function handleGetInstanceStats(
  db: Database,
  config: CrabshackConfig,
  name: string,
): Promise<Response> {
  const inst = getInstance(db, name);
  if (!inst) return Response.json({ error: "Not found" }, { status: 404 });

  const allocs = await getJobAllocs(config.nomadAddr, inst.nomad_job_id);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) {
    return Response.json({ name, stats: {} });
  }

  const allocId = (running as any).ID as string;
  const rawStats = await getAllocStats(config.nomadAddr, allocId);

  return Response.json({ name, stats: rawStats });
}

function parseMemMb(mem: string): number {
  const lower = mem.toLowerCase();
  if (lower.endsWith("g")) return parseFloat(lower) * 1024;
  if (lower.endsWith("m")) return parseFloat(lower);
  return parseFloat(lower);
}
