const DEBUG = process.env.CRABSHACK_DEBUG === "1";

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log("[debug]", ...args);
}
