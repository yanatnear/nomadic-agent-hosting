export type {
  UiConfig, TunnelStatus, DnsCheck, DnsResult, TunnelSetupResult,
  InstanceStatus, ServiceType, Instance, User, Backup,
} from "./api-types.ts";
export { gatewayUrl } from "./api-types.ts";

import type { Instance, User, Backup, UiConfig, TunnelStatus, DnsResult, TunnelSetupResult } from "./api-types.ts";

const BASE = "/api/crabshack";

async function request<T>(path: string, opts: RequestInit | null): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function uiRequest<T>(path: string, opts: RequestInit | null): Promise<T> {
  const res = await fetch(`/api/ui${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listUsers: () => request<User[]>("/users", null),
  listInstances: () => request<Instance[]>("/instances", null),
  getInstance: (name: string) => request<Instance>(`/instances/${name}`, null),

  createInstanceSSE: (data: Record<string, string>) =>
    fetch(`${BASE}/instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteInstanceSSE: (name: string) =>
    fetch(`${BASE}/instances/${name}`, { method: "DELETE" }),

  listInstanceBackups: (name: string) => request<Backup[]>(`/instances/${name}/backups`, null),
  createBackupSSE: (name: string) =>
    fetch(`${BASE}/instances/${name}/backup`, { method: "POST" }),
  restoreBackupSSE: (name: string, backupId: string) =>
    fetch(`${BASE}/instances/${name}/restore/${backupId}`, { method: "POST" }),

  getUiConfig: () => uiRequest<UiConfig>("/config", null),
  getTunnelStatus: () => uiRequest<TunnelStatus>("/tunnel", null),
  checkDns: (instances: string[]) =>
    uiRequest<DnsResult>("/dns", { method: "POST", body: JSON.stringify({ instances }) }),
  setupCfTunnel: () =>
    uiRequest<TunnelSetupResult>("/cf/setup", { method: "POST" }),
};
