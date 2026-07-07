"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, setSession } from "@/lib/store";

type Project = { id: string; name: string };

export default function Connect() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_TRELLIS_API || "http://localhost:8787");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (s) {
      setApiUrl(s.apiUrl);
      setToken(s.token);
    }
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${res.status} — check the token`);
      const data = (await res.json()) as { projects: Project[] };
      setSession({ apiUrl, token });
      setProjects(data.projects);
      if (data.projects.length === 1) router.push(`/p/${data.projects[0]!.id}/worklist`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card auth-card" style={{ padding: 24 }}>
        <div className="brand" style={{ padding: "0 0 8px" }}>
          <span className="dot" /> Trellis
        </div>
        <p className="mutedtext" style={{ marginTop: 0, fontSize: 13 }}>
          Connect with an API URL and an operator token (shown when a project is created).
        </p>
        <label>API URL</label>
        <input className="input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        <label>Token</label>
        <input className="input mono" placeholder="trk_…" value={token} onChange={(e) => setToken(e.target.value)} />
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <button className="btn primary" style={{ width: "100%", marginTop: 16 }} onClick={connect} disabled={busy || !token}>
          {busy ? "Connecting…" : "Connect"}
        </button>

        {projects && (
          <>
            <div className="section-title">Projects</div>
            {projects.length === 0 && <p className="mutedtext" style={{ fontSize: 13 }}>No projects for this token.</p>}
            {projects.map((p) => (
              <button key={p.id} className="btn" style={{ width: "100%", marginBottom: 6, justifyContent: "flex-start" }} onClick={() => router.push(`/p/${p.id}/triage`)}>
                {p.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
