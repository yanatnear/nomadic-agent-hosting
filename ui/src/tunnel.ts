import { openSync, readFileSync } from "node:fs";

const LOG_FILE = "/tmp/crabshack-tunnel.log";

let childProc: ReturnType<typeof Bun.spawn> | null = null;

export function tunnelStatus(): { running: boolean; pid: number; log: string } {
  if (!childProc || childProc.exitCode !== null) {
    return { running: false, pid: 0, log: "" };
  }
  let log = "";
  try { log = readFileSync(LOG_FILE, "utf-8").slice(-4000); } catch {}
  return { running: true, pid: childProc.pid, log };
}

export async function ensureTunnel(token: string): Promise<{ pid: number; started: boolean; alive: boolean }> {
  if (childProc && childProc.exitCode === null) {
    return { pid: childProc.pid, started: false, alive: true };
  }

  const logFd = openSync(LOG_FILE, "w");
  childProc = Bun.spawn(
    ["cloudflared", "tunnel", "run", "--token", token],
    { stdout: logFd, stderr: logFd },
  );

  await Bun.sleep(1000);
  const alive = childProc.exitCode === null;
  return { pid: childProc.pid, started: true, alive };
}
