import { debugLog } from "../debug.ts";

/** Headers builder — includes X-Nomad-Token when a token is configured. */
function nomadHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (token) h["X-Nomad-Token"] = token;
  return h;
}

function nomadGetHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h["X-Nomad-Token"] = token;
  return h;
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export function buildJobSubmitUrl(nomadAddr: string): string {
  return `${nomadAddr}/v1/jobs`;
}

export function buildJobStopUrl(nomadAddr: string, jobId: string): string {
  return `${nomadAddr}/v1/job/${jobId}?purge=true`;
}

export interface AllocPorts {
  gatewayPort: number;
  sshPort: number;
  nodeIp: string;
}

export function parseAllocPorts(alloc: Record<string, unknown>): AllocPorts {
  const networks = (alloc as any).Resources?.Networks;
  if (!networks || networks.length === 0) throw new Error("No networks in allocation");
  const net = networks[0];
  const ports = net.DynamicPorts as { Label: string; Value: number }[];
  const gw = ports.find(p => p.Label === "gateway");
  const ssh = ports.find(p => p.Label === "ssh");
  if (!gw) throw new Error("No gateway port in allocation");
  if (!ssh) throw new Error("No ssh port in allocation");
  return { gatewayPort: gw.Value, sshPort: ssh.Value, nodeIp: net.IP };
}

export async function submitJob(nomadAddr: string, jobHcl: string, token = ""): Promise<string> {
  const parseResp = await fetch(`${nomadAddr}/v1/jobs/parse`, {
    method: "POST",
    headers: nomadHeaders(token),
    body: JSON.stringify({ JobHCL: jobHcl, Canonicalize: true }),
  });
  if (!parseResp.ok) throw new Error(`Nomad parse failed: ${await parseResp.text()}`);
  const job = await parseResp.json();
  const submitResp = await fetch(buildJobSubmitUrl(nomadAddr), {
    method: "POST",
    headers: nomadHeaders(token),
    body: JSON.stringify({ Job: job }),
  });
  if (!submitResp.ok) throw new Error(`Nomad submit failed: ${await submitResp.text()}`);
  const result = await submitResp.json();
  debugLog("Job submitted:", result.EvalID);
  return result.EvalID;
}

export async function stopJob(nomadAddr: string, jobId: string, token = ""): Promise<string> {
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}`, {
    method: "DELETE",
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad stop failed: ${await resp.text()}`);
  const result = await resp.json();
  return result.EvalID ?? "";
}

export async function purgeJob(nomadAddr: string, jobId: string, token = ""): Promise<void> {
  const resp = await fetch(buildJobStopUrl(nomadAddr, jobId), {
    method: "DELETE",
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad purge failed: ${await resp.text()}`);
}

export async function startJob(nomadAddr: string, jobId: string, token = ""): Promise<string> {
  // Re-submit with Stop=false to start a stopped job
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}`, {
    method: "GET",
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad get job failed: ${await resp.text()}`);
  const job = await resp.json();
  job.Stop = false;
  const submitResp = await fetch(buildJobSubmitUrl(nomadAddr), {
    method: "POST",
    headers: nomadHeaders(token),
    body: JSON.stringify({ Job: job }),
  });
  if (!submitResp.ok) throw new Error(`Nomad start failed: ${await submitResp.text()}`);
  const result = await submitResp.json();
  return result.EvalID ?? "";
}

export async function getJobAllocs(
  nomadAddr: string,
  jobId: string,
  token = "",
): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}/allocations`, {
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad allocs query failed: ${await resp.text()}`);
  return resp.json();
}

export async function getAllocLogs(
  nomadAddr: string,
  allocId: string,
  taskName: string,
  logType: string,
  tail: number,
  token = "",
): Promise<string> {
  const origin = tail > 0 ? "end" : "start";
  const resp = await fetch(
    `${nomadAddr}/v1/client/fs/logs/${allocId}?task=${taskName}&type=${logType}&origin=${origin}&offset=${tail > 0 ? tail * 512 : 0}&plain=true`,
    { headers: nomadGetHeaders(token) },
  );
  if (!resp.ok) return "";
  return resp.text();
}

export async function getAllocStats(
  nomadAddr: string,
  allocId: string,
  token = "",
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${nomadAddr}/v1/client/allocation/${allocId}/stats`, {
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) return {};
  return resp.json();
}

export interface ServiceEndpoint {
  address: string;
  port: number;
}

/** Resolve a dynamic port endpoint from a running Nomad allocation for a given job. */
export async function resolveAllocEndpoint(
  nomadAddr: string,
  jobId: string,
  portLabel: string,
  token = "",
): Promise<ServiceEndpoint | null> {
  const allocs = await getJobAllocs(nomadAddr, jobId, token);
  const running = allocs.find((a: any) => a.ClientStatus === "running");
  if (!running) return null;
  // The list endpoint doesn't include Resources; fetch the full allocation
  const allocId = (running as any).ID as string;
  const resp = await fetch(`${nomadAddr}/v1/allocation/${allocId}`, {
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) return null;
  const detail = await resp.json() as Record<string, unknown>;
  const networks = (detail as any).Resources?.Networks;
  if (!networks || networks.length === 0) return null;
  const net = networks[0];
  const ports = net.DynamicPorts as { Label: string; Value: number }[];
  const match = ports?.find(p => p.Label === portLabel);
  if (!match) return null;
  return { address: net.IP, port: match.Value };
}

export async function listNomadNodes(nomadAddr: string, token = ""): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${nomadAddr}/v1/nodes`, {
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad node list failed: ${await resp.text()}`);
  return resp.json();
}

export async function getNomadNode(nomadAddr: string, nodeId: string, token = ""): Promise<Record<string, unknown>> {
  const resp = await fetch(`${nomadAddr}/v1/node/${nodeId}`, {
    headers: nomadGetHeaders(token),
  });
  if (!resp.ok) throw new Error(`Nomad node get failed: ${await resp.text()}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Nomad Variables API — store secrets outside of job definitions
// ---------------------------------------------------------------------------

/**
 * Write a Nomad Variable (key/value map) at a given path.
 * Used to store per-instance secrets that jobs read via `template` blocks.
 * See: https://developer.hashicorp.com/nomad/api-docs/variables
 */
export async function putNomadVariable(
  nomadAddr: string,
  path: string,
  items: Record<string, string>,
  token = "",
): Promise<void> {
  const resp = await fetch(`${nomadAddr}/v1/var/${path}`, {
    method: "PUT",
    headers: nomadHeaders(token),
    body: JSON.stringify({ Path: path, Items: items }),
  });
  if (!resp.ok) throw new Error(`Nomad variable PUT failed (${path}): ${await resp.text()}`);
}

/**
 * Delete a Nomad Variable at a given path.
 */
export async function deleteNomadVariable(
  nomadAddr: string,
  path: string,
  token = "",
): Promise<void> {
  const resp = await fetch(`${nomadAddr}/v1/var/${path}`, {
    method: "DELETE",
    headers: nomadGetHeaders(token),
  });
  // 404 is fine — variable may already be gone
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Nomad variable DELETE failed (${path}): ${await resp.text()}`);
  }
}
