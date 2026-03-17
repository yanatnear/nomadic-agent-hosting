import type { ServiceEndpoint } from "../nomad/nomad-client.ts";

export function buildGatewayTarget(ep: ServiceEndpoint, path: string): string {
  return `http://${ep.address}:${ep.port}${path}`;
}
