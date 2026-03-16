export function buildServiceUrl(consulAddr: string, serviceName: string): string {
  return `${consulAddr}/v1/catalog/service/${serviceName}`;
}

export interface ServiceEndpoint {
  address: string;
  port: number;
}

export function parseServiceEndpoint(entry: Record<string, unknown>): ServiceEndpoint {
  const svcAddr = entry.ServiceAddress as string;
  const nodeAddr = entry.Address as string;
  return { address: svcAddr || nodeAddr, port: entry.ServicePort as number };
}

export async function resolveService(
  consulAddr: string,
  serviceName: string
): Promise<ServiceEndpoint | null> {
  const resp = await fetch(buildServiceUrl(consulAddr, serviceName));
  if (!resp.ok) return null;
  const entries = await resp.json() as Record<string, unknown>[];
  if (entries.length === 0) return null;
  return parseServiceEndpoint(entries[0]);
}
