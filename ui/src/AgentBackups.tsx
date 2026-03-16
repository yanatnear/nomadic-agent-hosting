import { useState, useEffect, useCallback } from "react";
import { api, type Backup } from "./api.ts";

export function AgentBackups({ instanceName }: { instanceName: string }) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.listInstanceBackups(instanceName).then(setBackups).catch((e) => setError(String(e)));
  }, [instanceName]);

  useEffect(() => { refresh(); }, [refresh]);

  function createBackup(): void {
    setBusy(true);
    api.createBackupSSE(instanceName)
      .then(() => { setBusy(false); refresh(); })
      .catch((e) => { setError(String(e)); setBusy(false); });
  }

  function restoreBackup(backupId: string): void {
    if (!confirm("Restore this backup? Current data will be overwritten.")) return;
    setBusy(true);
    api.restoreBackupSSE(instanceName, backupId)
      .then(() => { setBusy(false); refresh(); })
      .catch((e) => { setError(String(e)); setBusy(false); });
  }

  return (
    <div style={{ background: "#111", border: "1px solid #333", borderRadius: 6, padding: "1rem", marginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Backups for {instanceName}</h3>
        <button onClick={createBackup} disabled={busy}
          style={{ padding: "0.2rem 0.6rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: "0.8rem" }}>
          Create Backup
        </button>
      </div>
      {error && <p style={{ color: "#f87171", fontSize: "0.85rem" }}>{error}</p>}
      {backups.length === 0 && !error && <p style={{ color: "#888", fontSize: "0.85rem" }}>No backups</p>}
      {backups.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", textAlign: "left" }}>
              <th style={{ padding: "0.3rem" }}>ID</th>
              <th style={{ padding: "0.3rem" }}>Status</th>
              <th style={{ padding: "0.3rem" }}>Created</th>
              <th style={{ padding: "0.3rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.3rem", fontFamily: "monospace" }}>{b.id.slice(0, 8)}</td>
                <td style={{ padding: "0.3rem" }}>{b.status}</td>
                <td style={{ padding: "0.3rem", color: "#888" }}>{new Date(b.created_at).toLocaleString()}</td>
                <td style={{ padding: "0.3rem" }}>
                  <button onClick={() => restoreBackup(b.id)} disabled={busy}
                    style={{ padding: "0.15rem 0.4rem", background: "#333", color: "#e0e0e0", border: "none", borderRadius: 3, cursor: "pointer", fontSize: "0.75rem" }}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
