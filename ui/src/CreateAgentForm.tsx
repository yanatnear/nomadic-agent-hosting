import { useState } from "react";
import { api } from "./api.ts";

const IMAGE_PRESETS = [
  "ironclaw-nearai-worker:local",
  "openclaw-nearai-worker:local",
];

function serviceTypeFromImage(image: string): string {
  if (image.includes("ironclaw")) return "ironclaw-dind";
  return "openclaw";
}

export function CreateAgentForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [image, setImage] = useState(() => localStorage.getItem("crabshack_last_image") || IMAGE_PRESETS[0]);
  const [serviceType, setServiceType] = useState(() => localStorage.getItem("crabshack_last_service_type") || "ironclaw-dind");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    fd.forEach((v, k) => { if (v) data[k] = v as string; });

    localStorage.setItem("crabshack_last_image", data.image || "");
    localStorage.setItem("crabshack_last_service_type", data.service_type || "");
    localStorage.setItem("crabshack_last_ssh_pubkey", data.ssh_pubkey || "");

    setBusy(true);
    setStatus("Creating...");
    api.createInstanceSSE(data).then(async (resp) => {
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: resp.statusText }));
        setStatus(`Error: ${(body as any).error ?? resp.statusText}`);
        setBusy(false);
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) { setStatus("No stream"); setBusy(false); return; }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const evt = line.slice(7).trim();
            if (evt === "done") { setStatus("Done!"); setBusy(false); onCreated(); return; }
            if (evt === "error") { setStatus("Deployment error"); setBusy(false); return; }
            setStatus(evt);
          }
        }
      }
      setBusy(false);
      onCreated();
    }).catch((err) => { setStatus(`Error: ${err}`); setBusy(false); });
  }

  return (
    <div style={{ border: "1px solid #2a2a2a", borderRadius: 6, padding: "1rem", marginBottom: "1rem", background: "#0d0d0d" }}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>Image</label>
            <input name="image" list="img-presets" value={image}
              onChange={(e) => { setImage(e.target.value); setServiceType(serviceTypeFromImage(e.target.value)); }}
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
            <datalist id="img-presets">
              {IMAGE_PRESETS.map((img) => <option key={img} value={img} />)}
            </datalist>
          </div>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>Service Type</label>
            <select name="service_type" value={serviceType} onChange={(e) => setServiceType(e.target.value)}
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }}>
              <option value="openclaw">openclaw</option>
              <option value="ironclaw">ironclaw</option>
              <option value="ironclaw-dind">ironclaw-dind</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>Memory</label>
            <input name="mem_limit" defaultValue="4g"
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
          </div>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>CPUs</label>
            <input name="cpus" defaultValue="1"
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
          </div>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>NEARAI API Key</label>
            <input name="nearai_api_key" required
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
          </div>
          <div>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>NEARAI API URL</label>
            <input name="nearai_api_url" defaultValue="https://api.near.ai"
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", color: "#aaa", fontSize: "0.8rem" }}>SSH Public Key</label>
            <input name="ssh_pubkey" placeholder="ssh-ed25519 AAAA... user@host"
              defaultValue={localStorage.getItem("crabshack_last_ssh_pubkey") || ""}
              style={{ width: "100%", padding: "0.3rem", background: "#1a1a1a", border: "1px solid #333", color: "#e0e0e0", borderRadius: 3 }} />
          </div>
        </div>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button type="submit" disabled={busy}
            style={{ padding: "0.3rem 0.8rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Create
          </button>
          <button type="button" onClick={onClose}
            style={{ padding: "0.3rem 0.8rem", background: "#333", color: "#e0e0e0", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </form>
      {status && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: status.startsWith("Error") ? "#f87171" : "#4ade80" }}>
          {status}
        </div>
      )}
    </div>
  );
}
