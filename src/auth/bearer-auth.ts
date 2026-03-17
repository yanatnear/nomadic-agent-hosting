import { timingSafeEqual } from "node:crypto";

export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isAdminToken(token: string, adminSecret: string): boolean {
  return safeCompare(token, adminSecret);
}
