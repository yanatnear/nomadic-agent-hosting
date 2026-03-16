import type { CrabshackConfig } from "../config.ts";
import { listNomadNodes } from "../nomad/nomad-client.ts";

export async function handleListNodes(config: CrabshackConfig): Promise<Response> {
  const nodes = await listNomadNodes(config.nomadAddr);
  const result = nodes.map((n: any) => ({
    id: n.ID,
    hostname: n.Name,
    ssh_host: n.Address,
    ssh_port: 22,
    ssh_user: "",
    status: n.Status === "ready" ? "active" : n.Status,
    datacenter: n.Datacenter,
    drain: n.Drain,
  }));
  return Response.json(result);
}
