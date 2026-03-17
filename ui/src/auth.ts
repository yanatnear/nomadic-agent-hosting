import { createHash } from "node:crypto";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 32);
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function isAuthed(req: Request, secret: string): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const expected = hashSecret(secret);
  return parseCookie(cookie, "crabshack_session") === expected;
}

export function isAdminAuthed(req: Request, secret: string): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const expected = hashSecret(secret);
  return parseCookie(cookie, "crabshack_admin") === expected;
}

export function cookieZone(req: Request, zone: string): string {
  if (zone) return zone;
  const host = req.headers.get("host") ?? "";
  return host.split(":")[0] ?? "";
}

export function setCookie(secret: string, domain: string): string {
  const val = hashSecret(secret);
  const parts = [`crabshack_session=${val}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=604800"];
  if (domain && domain !== "localhost") parts.push(`Domain=.${domain}`);
  return parts.join("; ");
}

export function setAdminCookie(secret: string, domain: string): string {
  const val = hashSecret(secret);
  const parts = [`crabshack_admin=${val}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=604800"];
  if (domain && domain !== "localhost") parts.push(`Domain=.${domain}`);
  return parts.join("; ");
}

export function clearCookie(domain: string): string {
  const parts = ["crabshack_session=deleted", "Path=/", "HttpOnly", "Max-Age=0"];
  if (domain && domain !== "localhost") parts.push(`Domain=.${domain}`);
  return parts.join("; ");
}

export function clearAdminCookie(domain: string): string {
  const parts = ["crabshack_admin=deleted", "Path=/", "HttpOnly", "Max-Age=0"];
  if (domain && domain !== "localhost") parts.push(`Domain=.${domain}`);
  return parts.join("; ");
}

export function loginPage(error: string, redirect: string): Response {
  const safeErr = error.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const safeRedirect = redirect.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>CrabShack Login</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .box{background:#111;border:1px solid #333;border-radius:8px;padding:2rem;max-width:360px;width:100%}
  h1{font-size:1.2rem;margin:0 0 1rem}
  input{width:100%;padding:.5rem;margin:.5rem 0;background:#1a1a1a;border:1px solid #333;color:#e0e0e0;border-radius:4px;box-sizing:border-box}
  button{width:100%;padding:.5rem;margin-top:.5rem;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer}
  .err{color:#f87171;font-size:.85rem}
</style>
</head><body>
<div class="box">
  <h1>CrabShack</h1>
  ${safeErr ? `<p class="err">${safeErr}</p>` : ""}
  <form method="POST" action="/api/auth/login">
    <input type="hidden" name="redirect" value="${safeRedirect}"/>
    <input type="password" name="secret" placeholder="Admin secret" autofocus/>
    <button type="submit">Login</button>
  </form>
</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
