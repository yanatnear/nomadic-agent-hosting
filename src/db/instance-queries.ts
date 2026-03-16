import type { Database } from "bun:sqlite";

export interface InstanceRow {
  name: string;
  user_id: string;
  service_type: string;
  nomad_job_id: string;
  status: string;
  created_at: string;
  error_message: string | null;
  image: string;
  mem_limit: string;
  cpus: string;
  storage_size: string;
  ssh_pubkey: string;
  token: string;
  node_id: string;
  meta: string;
}

export interface CreateInstanceParams {
  name: string;
  userId: string;
  serviceType: string;
  nomadJobId: string;
  image: string;
  memLimit: string;
  cpus: string;
  storageSize: string;
  sshPubkey: string;
  token: string;
}

export function createInstance(db: Database, params: CreateInstanceParams): void {
  db.run(
    `INSERT INTO instances (name, user_id, service_type, nomad_job_id, image, mem_limit, cpus, storage_size, ssh_pubkey, token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.name, params.userId, params.serviceType, params.nomadJobId,
     params.image, params.memLimit, params.cpus, params.storageSize,
     params.sshPubkey, params.token]
  );
}

export function getInstance(db: Database, name: string): InstanceRow | null {
  return db.query<InstanceRow, [string]>(
    "SELECT * FROM instances WHERE name = ?"
  ).get(name);
}

export function listInstances(db: Database, userId: string): InstanceRow[] {
  return db.query<InstanceRow, [string]>(
    "SELECT * FROM instances WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId);
}

export function listAllInstances(db: Database): InstanceRow[] {
  return db.query<InstanceRow, []>(
    "SELECT * FROM instances ORDER BY created_at DESC"
  ).all();
}

export function deleteInstance(db: Database, name: string): void {
  db.run("DELETE FROM instances WHERE name = ?", [name]);
}

export function updateInstanceStatus(
  db: Database,
  name: string,
  status: string,
): void {
  db.run(
    "UPDATE instances SET status = ? WHERE name = ?",
    [status, name]
  );
}

export function updateInstanceNodeId(
  db: Database,
  name: string,
  nodeId: string,
): void {
  db.run(
    "UPDATE instances SET node_id = ? WHERE name = ?",
    [nodeId, name]
  );
}
