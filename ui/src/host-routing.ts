export function extractAgent(host: string, zone: string): string | null {
  if (!zone) return null;
  const h = host.split(":")[0] ?? "";
  if (h === zone) return null;
  if (h === `admin.${zone}`) return null;
  if (h === `api.${zone}`) return null;
  if (h.endsWith("." + zone)) return h.slice(0, -(zone.length + 1));
  return null;
}

export function isApiHost(host: string, zone: string): boolean {
  if (!zone) return false;
  const h = host.split(":")[0] ?? "";
  return h === `api.${zone}`;
}

export function isAdminHost(host: string, zone: string): boolean {
  const h = host.split(":")[0] ?? "";
  if (!zone) return true;
  if (h === `admin.${zone}`) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return true;
  return false;
}

export function isUserHost(host: string, zone: string): boolean {
  if (!zone) return false;
  const h = host.split(":")[0] ?? "";
  return h === zone;
}

export function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
