import { useState, useEffect, useCallback } from "react";
import { api, type User } from "./api.ts";

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    api.listUsers().then(setUsers).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={{ background: "#111", border: "1px solid #333", borderRadius: 6, padding: "1rem" }}>
      <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>Users</h2>
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {users.length === 0 && !error && <p style={{ color: "#888" }}>No users</p>}
      {users.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333", textAlign: "left" }}>
              <th style={{ padding: "0.4rem" }}>User ID</th>
              <th style={{ padding: "0.4rem" }}>Display Name</th>
              <th style={{ padding: "0.4rem" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.4rem", fontFamily: "monospace", fontSize: "0.8rem" }}>{u.user_id}</td>
                <td style={{ padding: "0.4rem" }}>{u.display_name || "—"}</td>
                <td style={{ padding: "0.4rem", color: "#888" }}>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
