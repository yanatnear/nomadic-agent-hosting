import { serve } from "bun";
import { isAuthed, isAdminAuthed, setCookie, setAdminCookie, clearCookie, clearAdminCookie, cookieZone, loginPage } from "./auth.ts";
import { ensureTunnel } from "./tunnel.ts";
import { proxyToApiAdmin, proxyToApiPassthrough, proxyToAgent, resolveGw } from "./proxy.ts";
import { type GwWsData, websocketHandler, upgradeWs } from "./ws-bridge.ts";
import { extractAgent, isApiHost, isUserHost, isAdminHost, jsonResponse } from "./host-routing.ts";
import { handleUiApi, type UiApiDeps } from "./ui-api-routes.ts";

const SECRET = process.env.CRABSHACK_ADMIN_SECRET ?? "";
const ZONE = process.env.CRABSHACK_UI_ZONE ?? "";
const CF_TOKEN = process.env.CRABSHACK_UI_CF_TOKEN ?? "";
const CF_API_TOKEN = process.env.CRABSHACK_CF_API_TOKEN ?? "";
const DEBUG = process.env.CRABSHACK_DEBUG === "1";

const uiDeps: UiApiDeps = { zone: ZONE, cfApiToken: CF_API_TOKEN, cfToken: CF_TOKEN, secret: SECRET };

function nocache(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return new Response(res.body, { status: res.status, headers: h });
}

function isSafeRedirect(url: string): boolean {
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  return true;
}

async function handleAdminLogin(req: Request): Promise<Response> {
  const { timingSafeEqual } = await import("node:crypto");
  const form = await req.formData();
  const secret = form.get("secret") as string;
  const rawRedirect = (form.get("redirect") as string) || "/";
  const redirect = isSafeRedirect(rawRedirect) ? rawRedirect : "/";
  const a = Buffer.from(secret), b = Buffer.from(SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return loginPage("Invalid secret", redirect);
  const zone = cookieZone(req, ZONE);
  const headers = new Headers({ Location: redirect });
  headers.append("Set-Cookie", setCookie(SECRET, zone));
  headers.append("Set-Cookie", setAdminCookie(SECRET, zone));
  return new Response(null, { status: 302, headers });
}

if (CF_TOKEN) {
  console.log(`CF tunnel token: ${CF_TOKEN.slice(0, 6)}...${CF_TOKEN.slice(-6)} (${CF_TOKEN.length} chars)`);
  ensureTunnel(CF_TOKEN).then(({ pid, started, alive }) => {
    if (!started) console.log(`CF tunnel already running (pid=${pid})`);
    else if (alive) console.log(`Started CF tunnel (pid=${pid})`);
    else console.error(`CF tunnel started but died immediately (pid=${pid}). Check: cat /tmp/crabshack-tunnel.log`);
  }).catch((err) => console.error("CF tunnel error:", err));
}

export const server = serve<GwWsData>({
  port: parseInt(process.env.CRABSHACK_UI_PORT ?? "3000", 10),
  routes: {
    "/*": async (req: Request, srv: any) => {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? "";
      if (DEBUG) console.log(`[ui] ${req.method} ${host}${url.pathname}${url.search}`);

      if (isApiHost(host, ZONE)) {
        return proxyToApiPassthrough(req);
      }

      const agent = extractAgent(host, ZONE);
      if (agent) {
        if (!isAuthed(req, SECRET)) {
          if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            return new Response("Unauthorized", { status: 401 });
          }
          const proto = ZONE ? "https:" : url.protocol;
          const origUrl = ZONE ? url.href.replace(/^http:/, "https:") : url.href;
          return new Response(null, { status: 302, headers: { Location: `${proto}//${ZONE}/login?r=${encodeURIComponent(origUrl)}` } });
        }
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const gw = await resolveGw(agent);
          if (!gw) return new Response("Agent not found", { status: 404 });
          const target = new URL(`ws://${gw.address}:${gw.port}${url.pathname}`);
          target.searchParams.set("token", gw.token);
          url.searchParams.forEach((v, k) => { if (k !== "token") target.searchParams.set(k, v); });
          return upgradeWs(req, srv, target.toString());
        }
        return proxyToAgent(agent, req);
      }

      if (isUserHost(host, ZONE)) {
        return nocache(new Response("<html><body>User portal</body></html>", { headers: { "Content-Type": "text/html" } }));
      }

      if (!isAdminAuthed(req, SECRET)) {
        return new Response(null, { status: 302, headers: { Location: `/login?r=${encodeURIComponent(url.pathname + url.search)}` } });
      }
      return nocache(new Response("<html><body>Admin dashboard</body></html>", { headers: { "Content-Type": "text/html" } }));
    },
    "/api/crabshack/*": (req: Request, srv: any) => {
      const url = new URL(req.url);
      if (DEBUG) console.log(`[ui] ${req.method} ${url.pathname}${url.search}`);

      const host = req.headers.get("host") ?? "";
      const isPortal = isUserHost(host, ZONE);

      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const API_URL = process.env.CRABSHACK_API_URL ?? "http://localhost:7700";
        const path = url.pathname.replace("/api/crabshack", "");
        const wsUrl = API_URL.replace(/^http/, "ws") + path + url.search;
        return upgradeWs(req, srv, wsUrl);
      }

      if (isPortal) return proxyToApiPassthrough(req);
      if (!isAdminAuthed(req, SECRET)) return jsonResponse({ error: "Unauthorized" }, 401);
      return proxyToApiAdmin(req);
    },
    "/api/ui/config": (req: Request) => handleUiApi(req, "/api/ui/config", uiDeps),
    "/api/ui/tunnel": (req: Request) => handleUiApi(req, "/api/ui/tunnel", uiDeps),
    "/api/ui/dns": (req: Request) => handleUiApi(req, "/api/ui/dns", uiDeps),
    "/api/auth/check": (req: Request) => handleUiApi(req, "/api/auth/check", uiDeps),
    "/api/ui/cf/setup": (req: Request) => handleUiApi(req, "/api/ui/cf/setup", uiDeps),
    "/login": (req: Request) => {
      const url = new URL(req.url);
      return nocache(loginPage("", url.searchParams.get("r") ?? "/"));
    },
    "/api/auth/login": (req: Request) =>
      req.method === "POST" ? handleAdminLogin(req) : jsonResponse({ error: "Method not allowed" }, 405),
    "/api/auth/logout": (req: Request) => {
      const zone = cookieZone(req, ZONE);
      const headers = new Headers({ Location: "/login" });
      headers.append("Set-Cookie", clearCookie(zone));
      headers.append("Set-Cookie", clearAdminCookie(zone));
      return new Response(null, { status: 302, headers });
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? "";
    if (DEBUG) console.log(`[ui:fallback] ${req.method} ${host}${url.pathname}`);

    if (isApiHost(host, ZONE)) {
      return proxyToApiPassthrough(req);
    }
    const agent = extractAgent(host, ZONE);
    if (agent) {
      if (!isAuthed(req, SECRET)) return new Response("Unauthorized", { status: 401 });
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const gw = await resolveGw(agent);
        if (!gw) return new Response("Agent not found", { status: 404 });
        const target = new URL(`ws://${gw.address}:${gw.port}${url.pathname}`);
        target.searchParams.set("token", gw.token);
        url.searchParams.forEach((v, k) => { if (k !== "token") target.searchParams.set(k, v); });
        return upgradeWs(req, server, target.toString());
      }
      return proxyToAgent(agent, req);
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: websocketHandler,
});

console.log(`CrabShack UI running at ${server.url}`);
if (ZONE) console.log(`Zone: ${ZONE} (subdomain routing enabled)`);
