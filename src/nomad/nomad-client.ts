import { debugLog } from "../debug.ts";

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

export async function submitJob(nomadAddr: string, jobHcl: string): Promise<string> {
  const parseResp = await fetch(`${nomadAddr}/v1/jobs/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ JobHCL: jobHcl, Canonicalize: true }),
  });
  if (!parseResp.ok) throw new Error(`Nomad parse failed: ${await parseResp.text()}`);
  const job = await parseResp.json();
  const submitResp = await fetch(buildJobSubmitUrl(nomadAddr), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Job: job }),
  });
  if (!submitResp.ok) throw new Error(`Nomad submit failed: ${await submitResp.text()}`);
  const result = await submitResp.json();
  debugLog("Job submitted:", result.EvalID);
  return result.EvalID;
}

export async function stopJob(nomadAddr: string, jobId: string): Promise<string> {
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Nomad stop failed: ${await resp.text()}`);
  const result = await resp.json();
  return result.EvalID ?? "";
}

export async function purgeJob(nomadAddr: string, jobId: string): Promise<void> {
  const resp = await fetch(buildJobStopUrl(nomadAddr, jobId), { method: "DELETE" });
  if (!resp.ok) throw new Error(`Nomad purge failed: ${await resp.text()}`);
}

export async function startJob(nomadAddr: string, jobId: string): Promise<string> {
  // Re-submit with Stop=false to start a stopped job
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}`, {
    method: "GET",
  });
  if (!resp.ok) throw new Error(`Nomad get job failed: ${await resp.text()}`);
  const job = await resp.json();
  job.Stop = false;
  const submitResp = await fetch(buildJobSubmitUrl(nomadAddr), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Job: job }),
  });
  if (!submitResp.ok) throw new Error(`Nomad start failed: ${await submitResp.text()}`);
  const result = await submitResp.json();
  return result.EvalID ?? "";
}

export async function getJobAllocs(
  nomadAddr: string,
  jobId: string
): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${nomadAddr}/v1/job/${jobId}/allocations`);
  if (!resp.ok) throw new Error(`Nomad allocs query failed: ${await resp.text()}`);
  return resp.json();
}

export async function getAllocLogs(
  nomadAddr: string,
  allocId: string,
  taskName: string,
  logType: string,
  tail: number,
): Promise<string> {
  const origin = tail > 0 ? "end" : "start";
  const resp = await fetch(
    `${nomadAddr}/v1/client/fs/logs/${allocId}?task=${taskName}&type=${logType}&origin=${origin}&offset=${tail > 0 ? tail * 512 : 0}&plain=true`
  );
  if (!resp.ok) return "";
  return resp.text();
}

export async function getAllocStats(
  nomadAddr: string,
  allocId: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${nomadAddr}/v1/client/allocation/${allocId}/stats`);
  if (!resp.ok) return {};
  return resp.json();
}

export async function listNomadNodes(nomadAddr: string): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${nomadAddr}/v1/nodes`);
  if (!resp.ok) throw new Error(`Nomad node list failed: ${await resp.text()}`);
  return resp.json();
}
