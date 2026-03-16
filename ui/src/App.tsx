import { useState, useEffect } from "react";
import { api, type UiConfig } from "./api.ts";
import { InstanceList } from "./InstanceList.tsx";
import { UserList } from "./UserList.tsx";

type Tab = "instances" | "users";

export function App() {
  const [tab, setTab] = useState<Tab>("instances");
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [config, setConfig] = useState<UiConfig | null>(null);

  useEffect(() => {
    fetch("/api/crabshack/health")
      .then((r) => setHealthy(r.ok))
      .catch(() => setHealthy(false));
    api.getUiConfig().then(setConfig).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1rem", fontFamily: "system-ui, -apple-system, sans-serif", color: "#e0e0e0", background: "#0a0a0a", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.3rem" }}>CrabShack v2</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: healthy === false ? "#f87171" : healthy ? "#4ade80" : "#888" }} />
          {healthy === null ? "Checking..." : healthy ? "Connected" : "Disconnected"}
        </div>
      </header>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={() => setTab("instances")} style={{ padding: "0.4rem 1rem", background: tab === "instances" ? "#3b82f6" : "#1a1a1a", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}>
          Instances
        </button>
        <button onClick={() => setTab("users")} style={{ padding: "0.4rem 1rem", background: tab === "users" ? "#3b82f6" : "#1a1a1a", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}>
          Users
        </button>
      </div>

      {tab === "instances" && <InstanceList zone={config?.zone ?? ""} />}
      {tab === "users" && <UserList />}
    </div>
  );
}
