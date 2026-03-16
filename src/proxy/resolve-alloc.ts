import type { ServiceEndpoint } from "../consul/consul-client.ts";

export function buildGatewayTarget(ep: ServiceEndpoint, path: string): string {
  return `http://${ep.address}:${ep.port}${path}`;
}
