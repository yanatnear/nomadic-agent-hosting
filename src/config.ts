export interface CrabshackConfig {
  adminSecret: string;
  port: number;
  dataDir: string;
  nomadAddr: string;
  consulAddr: string;
}

export function loadConfig(): CrabshackConfig {
  const adminSecret = process.env.CRABSHACK_ADMIN_SECRET;
  if (!adminSecret) throw new Error("CRABSHACK_ADMIN_SECRET is required");
  return {
    adminSecret,
    port: parseInt(process.env.CRABSHACK_PORT || "7700", 10),
    dataDir: process.env.CRABSHACK_DATA_DIR || "./crabshack-data",
    nomadAddr: process.env.NOMAD_ADDR || "http://127.0.0.1:4646",
    consulAddr: process.env.CONSUL_HTTP_ADDR || "http://127.0.0.1:8500",
  };
}
