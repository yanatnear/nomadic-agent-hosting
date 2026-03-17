import { resolveAllocEndpoint } from "../nomad/nomad-client.ts";
import { debugLog } from "../debug.ts";

export async function resolveWsTarget(
  nomadAddr: string,
  instanceName: string,
  nomadToken = "",
): Promise<string | null> {
  const ep = await resolveAllocEndpoint(nomadAddr, `agent-${instanceName}`, "gateway", nomadToken);
  if (!ep) return null;
  return `ws://${ep.address}:${ep.port}`;
}

export function handleWsUpgrade(
  server: { upgrade: (req: Request, data: unknown) => boolean },
  req: Request,
  targetUrl: string,
): boolean {
  debugLog("WebSocket upgrade to", targetUrl);
  return server.upgrade(req, { data: { targetUrl } });
}
