const CF = "https://api.cloudflare.com/client/v4";

function hdrs(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function cfGet(token: string, path: string) {
  const res = await fetch(`${CF}${path}`, { headers: hdrs(token) });
  return res.json() as Promise<any>;
}

async function cfPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${CF}${path}`, { method: "POST", headers: hdrs(token), body: JSON.stringify(body) });
  return res.json() as Promise<any>;
}

async function cfPut(token: string, path: string, body: unknown) {
  const res = await fetch(`${CF}${path}`, { method: "PUT", headers: hdrs(token), body: JSON.stringify(body) });
  return res.json() as Promise<any>;
}

async function findAccountId(token: string): Promise<string> {
  const data = await cfGet(token, "/accounts?per_page=5");
  const id = data.result?.[0]?.id;
  if (!id) throw new Error("No CF account found for this token");
  return id;
}

async function findZoneId(token: string, zone: string): Promise<string | null> {
  const data = await cfGet(token, "/zones?per_page=50");
  const match = (data.result ?? []).find((z: any) => zone === z.name || zone.endsWith("." + z.name));
  return match?.id ?? null;
}

async function upsertCname(token: string, zoneId: string, name: string, target: string) {
  const existing = await cfGet(token, `/zones/${zoneId}/dns_records?type=CNAME&name=${name}`);
  const record = existing.result?.[0];
  const body = { type: "CNAME", name, content: target, proxied: true };
  if (record) {
    await cfPut(token, `/zones/${zoneId}/dns_records/${record.id}`, body);
  } else {
    await cfPost(token, `/zones/${zoneId}/dns_records`, body);
  }
}

async function checkEdgeCert(token: string, zoneId: string, zone: string, steps: string[]) {
  const certsData = await cfGet(token, `/zones/${zoneId}/ssl/certificate_packs?status=all`);
  const certs = certsData.result ?? [];
  const wildcardHost = `*.${zone}`;
  const hasCoverage = certs.some((c: any) =>
    c.status === "active" && (c.hosts ?? []).some((h: string) => h === wildcardHost),
  );
  if (hasCoverage) {
    steps.push(`SSL: ACM cert covers ${wildcardHost}`);
  } else {
    steps.push(`SSL: no cert covers ${wildcardHost} — order ACM cert in CF Dashboard`);
  }
}

export async function setupTunnel(apiToken: string, zone: string, originPort: number) {
  const steps: string[] = [];
  const accountId = await findAccountId(apiToken);
  steps.push(`Account: ${accountId}`);

  const tunnelName = `crabshack-${zone.replace(/\./g, "-")}`;
  const list = await cfGet(apiToken, `/accounts/${accountId}/cfd_tunnel?name=${tunnelName}&is_deleted=false`);
  let tunnelId = list.result?.[0]?.id;

  if (tunnelId) {
    steps.push(`Tunnel already exists: ${tunnelName} (${tunnelId})`);
  } else {
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const created = await cfPost(apiToken, `/accounts/${accountId}/cfd_tunnel`, {
      name: tunnelName, tunnel_secret: secret, config_src: "cloudflare",
    });
    if (!created.success) throw new Error(created.errors?.[0]?.message ?? "Failed to create tunnel");
    tunnelId = created.result.id;
    steps.push(`Created tunnel: ${tunnelName} (${tunnelId})`);
  }

  const origin = `http://localhost:${originPort}`;
  const ingress = await cfPut(apiToken, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: {
      ingress: [
        { hostname: zone, service: origin },
        { hostname: `*.${zone}`, service: origin },
        { service: "http_status:404" },
      ],
    },
  });
  if (!ingress.success) throw new Error(ingress.errors?.[0]?.message ?? "Failed to configure ingress");
  steps.push(`Ingress configured: ${zone}, *.${zone} -> ${origin}`);

  const zoneId = await findZoneId(apiToken, zone);
  if (zoneId) {
    const cname = `${tunnelId}.cfargotunnel.com`;
    await upsertCname(apiToken, zoneId, zone, cname);
    await upsertCname(apiToken, zoneId, `*.${zone}`, cname);
    steps.push(`DNS: ${zone} + *.${zone} -> ${cname}`);
    await checkEdgeCert(apiToken, zoneId, zone, steps);
  } else {
    steps.push("DNS: zone not found in account, create CNAME records manually");
  }

  const tokenData = await cfGet(apiToken, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
  const tunnelToken = tokenData.result as string;
  steps.push(`Tunnel token obtained (${tunnelToken.length} chars)`);

  return { tunnelId, tunnelName, tunnelToken, steps };
}
