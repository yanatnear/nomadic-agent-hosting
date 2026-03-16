import { tunnelStatus } from "./tunnel.ts";
import { setupTunnel } from "./cf-api.ts";

export interface UiApiDeps {
  zone: string;
  cfApiToken: string;
  cfToken: string;
  secret: string;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleUiApi(req: Request, path: string, deps: UiApiDeps): Promise<Response> {
  if (path === "/api/ui/config") {
    return json({
      zone: deps.zone,
      hasTunnel: !!deps.cfToken,
      hasCfApi: !!deps.cfApiToken,
    }, 200);
  }

  if (path === "/api/ui/tunnel") {
    return json(tunnelStatus(), 200);
  }

  if (path === "/api/ui/dns" && req.method === "POST") {
    const body = (await req.json()) as { instances: string[] };
    const { promises: dnsPromises } = await import("node:dns");
    const results = await Promise.all(
      body.instances.map(async (name) => {
        const hostname = `${name}.${deps.zone}`;
        try {
          const addresses = await dnsPromises.resolve4(hostname);
          return { hostname, ok: true as const, addresses };
        } catch (err) {
          return { hostname, ok: false as const, error: String(err) };
        }
      }),
    );
    return json({ zone: deps.zone, results }, 200);
  }

  if (path === "/api/ui/cf/setup" && req.method === "POST") {
    if (!deps.cfApiToken) return json({ error: "CF API token not configured" }, 400);
    const result = await setupTunnel(deps.cfApiToken, deps.zone, 3000);
    return json(result, 200);
  }

  if (path === "/api/auth/check") {
    return json({ ok: true }, 200);
  }

  return json({ error: "Not found" }, 404);
}
