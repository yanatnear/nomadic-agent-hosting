import { resolveService } from "../consul/consul-client.ts";
import { buildGatewayTarget } from "./resolve-alloc.ts";
import { debugLog } from "../debug.ts";

export async function proxyToGateway(
  req: Request,
  consulAddr: string,
  instanceName: string,
): Promise<Response> {
  const ep = await resolveService(consulAddr, `agent-${instanceName}`);
  if (!ep) {
    return new Response(JSON.stringify({ error: "Instance not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const target = buildGatewayTarget(ep, url.pathname + url.search);
  debugLog("Proxying to", target);

  const proxyResp = await fetch(target, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(30_000),
  });

  return new Response(proxyResp.body, {
    status: proxyResp.status,
    headers: proxyResp.headers,
  });
}
