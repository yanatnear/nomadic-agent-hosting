import type { CrabshackConfig } from "../config.ts";
import type { AuthResult } from "./auth-routes.ts";
import { listNomadNodes, getNomadNode } from "../nomad/nomad-client.ts";

export async function handleListNodes(config: CrabshackConfig, auth: AuthResult): Promise<Response> {
  if (!auth.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const overrideHost = process.env.NODE_SSH_HOST;
  const overridePort = process.env.NODE_SSH_PORT ? parseInt(process.env.NODE_SSH_PORT, 10) : null;
  const overrideUser = process.env.NODE_SSH_USER;
  const nodes = await listNomadNodes(config.nomadAddr, config.nomadToken);
  const result = await Promise.all(nodes.map(async (n: any) => {
    let publicIp: string | undefined;
    let sysboxAvailable = false;
    try {
      const detail = await getNomadNode(config.nomadAddr, n.ID, config.nomadToken);
      publicIp = (detail.Meta as Record<string, string>)?.public_ip;
      sysboxAvailable = JSON.stringify(detail).includes("sysbox-runc");
    } catch {}
    return {
      id: n.ID,
      hostname: n.Name,
      ssh_host: overrideHost || publicIp || n.Address,
      ssh_port: overridePort || 22,
      ssh_user: overrideUser || "yan",
      status: n.Status === "ready" ? "active" : n.Status,
      datacenter: n.Datacenter,
      drain: n.Drain,
      sysbox_available: sysboxAvailable,
    };
  }));
  return Response.json(result);
}
