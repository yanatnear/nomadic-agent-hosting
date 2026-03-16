export interface UiConfig { zone: string; hasTunnel: boolean; hasCfApi: boolean }
export type TunnelStatus =
  | { running: true; pid: number; log: string; cfToken: boolean }
  | { running: false; cfToken: boolean }
export type DnsCheck =
  | { hostname: string; ok: true; addresses: string[] }
  | { hostname: string; ok: false; error: string }
export interface DnsResult { zone: string; results: DnsCheck[] }
export interface TunnelSetupResult { tunnelId: string; tunnelName: string; tunnelToken: string; steps: string[] }

export type InstanceStatus = "creating" | "running" | "stopped" | "error";
export type ServiceType = "openclaw" | "ironclaw" | "ironclaw-dind";

export interface Instance {
  name: string;
  status: InstanceStatus;
  service_type: ServiceType;
  image: string;
  mem_limit: string;
  cpus: string;
  storage_size: string;
  node_id: string | null;
  token: string;
  gateway_port: number | null;
  ssh_port: number | null;
  created_at: string;
}

export interface User {
  user_id: string;
  display_name: string;
  ssh_pubkey: string;
  created_at: string;
}

export interface Backup {
  id: string;
  instance_name: string;
  status: string;
  created_at: string;
}

export function gatewayUrl(name: string, zone: string, token: string): string {
  if (zone) return `https://${name}.${zone}/?token=${encodeURIComponent(token)}`;
  return `/api/crabshack/agents/${name}/gateway`;
}
