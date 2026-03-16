import type { ServerWebSocket } from "bun";

export interface GwWsData {
  targetUrl: string;
  upstream: WebSocket | null;
  buffer: string[];
  ready: boolean;
}

export const websocketHandler = {
  perMessageDeflate: false,
  open(ws: ServerWebSocket<GwWsData>) {
    const targetOrigin = new URL(ws.data.targetUrl).origin;
    const upstream = new WebSocket(ws.data.targetUrl, { headers: { Origin: targetOrigin } } as any);
    ws.data.upstream = upstream;
    upstream.addEventListener("open", () => {
      ws.data.ready = true;
      for (const msg of ws.data.buffer) upstream.send(msg);
      ws.data.buffer = [];
    });
    upstream.addEventListener("message", (e) => ws.send(e.data as string));
    upstream.addEventListener("close", () => ws.close());
    upstream.addEventListener("error", () => ws.close());
  },
  message(ws: ServerWebSocket<GwWsData>, msg: string | Buffer) {
    if (ws.data.ready && ws.data.upstream?.readyState === WebSocket.OPEN) {
      ws.data.upstream.send(msg);
    } else {
      ws.data.buffer.push(typeof msg === "string" ? msg : msg.toString());
    }
  },
  close(ws: ServerWebSocket<GwWsData>) { ws.data.upstream?.close(); },
};

export function upgradeWs(req: Request, server: any, targetUrl: string): Response | undefined {
  if (server.upgrade(req, { data: { targetUrl, upstream: null, buffer: [] as string[], ready: false } })) {
    return undefined;
  }
  return new Response("WebSocket upgrade failed", { status: 500 });
}
