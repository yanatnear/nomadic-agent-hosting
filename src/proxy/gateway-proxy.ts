import { resolveAllocEndpoint } from "../nomad/nomad-client.ts";
import { buildGatewayTarget } from "./resolve-alloc.ts";
import { debugLog } from "../debug.ts";

export async function proxyToGateway(
  req: Request,
  nomadAddr: string,
  instanceName: string,
  nomadToken = "",
): Promise<Response> {
  const ep = await resolveAllocEndpoint(nomadAddr, `agent-${instanceName}`, "gateway", nomadToken);
  if (!ep) {
    return new Response(JSON.stringify({ error: "Instance not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const target = buildGatewayTarget(ep, url.pathname + url.search);
  debugLog("Proxying to", target);

  // Strip caller's auth headers before forwarding to the agent container
  const proxyHeaders = new Headers(req.headers);
  proxyHeaders.delete("Authorization");
  proxyHeaders.delete("Cookie");

  const proxyResp = await fetch(target, {
    method: req.method,
    headers: proxyHeaders,
    body: req.body,
    signal: AbortSignal.timeout(30_000),
  });

  return new Response(proxyResp.body, {
    status: proxyResp.status,
    headers: proxyResp.headers,
  });
}
