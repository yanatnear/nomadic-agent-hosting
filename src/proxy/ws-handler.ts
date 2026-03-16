import { resolveService } from "../consul/consul-client.ts";
import { debugLog } from "../debug.ts";

export async function resolveWsTarget(
  consulAddr: string,
  instanceName: string,
): Promise<string | null> {
  const ep = await resolveService(consulAddr, `agent-${instanceName}`);
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
