export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function isAdminToken(token: string, adminSecret: string): boolean {
  return token === adminSecret;
}
