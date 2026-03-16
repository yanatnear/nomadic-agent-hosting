import { useState, useEffect, useCallback } from "react";
import { api, gatewayUrl, type Instance } from "./api.ts";
import { CreateAgentForm } from "./CreateAgentForm.tsx";

export function InstanceList({ zone }: { zone: string }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(() => {
    api.listInstances().then(setInstances).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={{ background: "#111", border: "1px solid #333", borderRadius: 6, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Instances</h2>
        <button onClick={() => setShowCreate(true)} style={{ padding: "0.3rem 0.8rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          Create
        </button>
      </div>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      {showCreate && (
        <CreateAgentForm
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      {instances.length === 0 && !error && <p style={{ color: "#888" }}>No instances</p>}

      {instances.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", textAlign: "left" }}>
              <th style={{ padding: "0.4rem" }}>Name</th>
              <th style={{ padding: "0.4rem" }}>Type</th>
              <th style={{ padding: "0.4rem" }}>Status</th>
              <th style={{ padding: "0.4rem" }}>Gateway</th>
              <th style={{ padding: "0.4rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((inst) => (
              <tr key={inst.name} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.4rem", color: "#60a5fa" }}>{inst.name}</td>
                <td style={{ padding: "0.4rem" }}>{inst.service_type}</td>
                <td style={{ padding: "0.4rem" }}>
                  <span style={{ color: inst.status === "running" ? "#4ade80" : inst.status === "error" ? "#f87171" : "#888" }}>
                    {inst.status}
                  </span>
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {inst.status === "running" && inst.gateway_port ? (
                    <a href={gatewayUrl(inst.name, zone, "")} target="_blank" rel="noopener" style={{ color: "#60a5fa" }}>
                      :{inst.gateway_port}
                    </a>
                  ) : "—"}
                </td>
                <td style={{ padding: "0.4rem" }}>
                  <button
                    onClick={() => { api.deleteInstanceSSE(inst.name).then(refresh); }}
                    style={{ padding: "0.2rem 0.5rem", background: "#991b1b", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: "0.8rem" }}
                  >
                    Delete
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
