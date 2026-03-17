const ADMIN_TOKEN = process.env.CRABSHACK_ADMIN_SECRET ?? "";
const API_URL = process.env.CRABSHACK_API_URL ?? "http://localhost:7700";
const DEBUG = process.env.CRABSHACK_DEBUG === "1";

export function proxyToApi(req: Request, injectAdmin: boolean): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/crabshack", "") + url.search;
  const headers = new Headers(req.headers);
  headers.delete("host");
  if (injectAdmin) headers.set("Authorization", `Bearer ${ADMIN_TOKEN}`);
  if (DEBUG) console.log(`[proxy:api] ${req.method} ${path}`);
  return fetch(`${API_URL}${path}`, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  }).then((res) => {
    const h = new Headers(res.headers);
    h.set("Cache-Control", "no-cache, no-store, must-revalidate");
    return new Response(res.body, { status: res.status, headers: h });
  });
}

export function proxyToApiAdmin(req: Request): Promise<Response> {
  return proxyToApi(req, true);
}

export function proxyToApiPassthrough(req: Request): Promise<Response> {
  return proxyToApi(req, false);
}

interface GwInfo { address: string; port: number; token: string; status: string; ts: number }
const gwCache = new Map<string, GwInfo>();
const gwInflight = new Map<string, Promise<GwInfo | null>>();
const CACHE_TTL = 30_000;

export function resolveGw(name: string): Promise<GwInfo | null> {
  const cached = gwCache.get(name);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return Promise.resolve(cached);
  const existing = gwInflight.get(name);
  if (existing) return existing;
  const promise = fetchGwInfo(name).finally(() => gwInflight.delete(name));
  gwInflight.set(name, promise);
  return promise;
}

async function fetchGwInfo(name: string): Promise<GwInfo | null> {
  try {
    const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };
    const instRes = await fetch(`${API_URL}/instances/${name}`, { headers });
    if (!instRes.ok) return null;
    const inst = (await instRes.json()) as {
      status: string;
      token: string;
      gateway_address: string | null;
      gateway_port: number | null;
    };

    if (!inst.gateway_address || !inst.gateway_port) return null;
    const gw: GwInfo = { address: inst.gateway_address, port: inst.gateway_port, token: inst.token, status: inst.status, ts: Date.now() };
    gwCache.set(name, gw);
    return gw;
  } catch { return null; }
}

const LOADING_TAGLINES = [
  "Convincing the hamsters to run faster...",
  "Reticulating splines...",
  "Warming up the quantum flux capacitor...",
  "Teaching the AI to tie its digital shoelaces...",
  "Brewing a fresh pot of machine learning...",
  "Untangling the neural networks...",
  "Asking the cloud nicely...",
  "Loading... have you tried turning it off and on again?",
  "Negotiating with the container runtime...",
  "Spinning up vibes...",
];

function agentLoadingPage(agent: string): Response {
  const safe = agent.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const tagline = LOADING_TAGLINES[Math.floor(Math.random() * LOADING_TAGLINES.length)];
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="refresh" content="3"/>
<title>${safe} -- Starting up</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;text-align:center}
  .box{max-width:420px;padding:2rem}
  h1{font-size:1.3rem;color:#fff;margin:0 0 .5rem}
  .agent{color:#60a5fa;font-family:'SF Mono','Fira Code',monospace}
  .tagline{color:#888;font-size:.9rem;margin:.75rem 0 1.5rem;font-style:italic}
  .spinner{display:inline-block;width:28px;height:28px;border:3px solid #333;border-top-color:#60a5fa;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .hint{color:#555;font-size:.75rem;margin-top:1.5rem}
</style>
</head><body>
<div class="box">
  <div class="spinner"></div>
  <h1 style="margin-top:1rem"><span class="agent">${safe}</span> is starting up</h1>
  <p class="tagline">${tagline}</p>
  <p class="hint">This page will refresh automatically.</p>
</div>
<script>setTimeout(()=>location.reload(),3000)</script>
</body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html", "Retry-After": "3" } });
}

function agentStoppedPage(agent: string, status: string): Response {
  const safe = agent.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const safeStatus = status.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${safe} -- ${safeStatus}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;text-align:center}
  .box{max-width:420px;padding:2rem}
  h1{font-size:1.3rem;color:#fff}
  .status{color:#f87171;font-family:'SF Mono','Fira Code',monospace}
</style>
</head><body>
<div class="box">
  <h1><span class="agent">${safe}</span></h1>
  <p>Status: <span class="status">${safeStatus}</span></p>
</div>
</body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html", "Retry-After": "30" } });
}

export async function proxyToAgent(agent: string, req: Request): Promise<Response> {
  const gw = await resolveGw(agent);
  if (!gw) return agentLoadingPage(agent);
  if (gw.status === "stopped" || gw.status === "error") {
    gwCache.delete(agent);
    return agentStoppedPage(agent, gw.status);
  }
  if (gw.status !== "running") {
    gwCache.delete(agent);
    return agentLoadingPage(agent);
  }

  const url = new URL(req.url);
  const upstream = new URL(`http://${gw.address}:${gw.port}${url.pathname}`);
  upstream.searchParams.set("token", gw.token);
  url.searchParams.forEach((v, k) => { if (k !== "token") upstream.searchParams.set(k, v); });

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("origin", upstream.origin);

  if (DEBUG) {
    const tokenPreview = gw.token ? `...${gw.token.slice(-4)}` : "(empty)";
    console.log(`[proxy] ${agent} ${req.method} ${url.pathname} -> ${upstream.host}`);
  }

  try {
    const resp = await fetch(upstream.toString(), {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "manual",
    });
    const outHeaders = new Headers(resp.headers);
    const location = outHeaders.get("location");
    if (location && location.startsWith(upstream.origin)) {
      outHeaders.set("location", location.slice(upstream.origin.length) || "/");
    }
    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  } catch {
    gwCache.delete(agent);
    return agentLoadingPage(agent);
  }
}
