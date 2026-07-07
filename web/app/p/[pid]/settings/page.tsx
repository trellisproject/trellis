"use client";
import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSession } from "@/lib/store";

type Member = { principalId: string; role: string; displayName: string; kind: string };
type ProjectView = { project: { id: string; name: string; joinCode?: string }; members: Member[] };

export default function Settings({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [data, setData] = useState<ProjectView | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api.get<ProjectView>(`/projects/${pid}`);
    setData(d);
  }
  useEffect(() => { setApiUrl(getSession()?.apiUrl ?? ""); load(); }, [pid]);

  async function rotate() {
    if (!confirm("Rotate the join code? The current code stops working immediately.")) return;
    setBusy(true);
    try { await api.post(`/projects/${pid}/join-code/rotate`); await load(); } finally { setBusy(false); }
  }

  function copy(label: string, text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  const code = data?.project.joinCode;
  const isOperator = data ? "joinCode" in data.project : false; // field present only for operators
  const trellisJson = JSON.stringify({ url: apiUrl, project: pid, joinCode: code ?? "…" }, null, 2);

  return (
    <>
      <div className="topbar"><h1>Settings</h1><span className="sub">Access & onboarding</span></div>
      <div className="content">
        {!data ? <div className="empty">Loading…</div> : (
          <>
            <div className="section-label" style={{ marginTop: 0 }}>Members ({data.members.length})</div>
            <div className="card">
              {data.members.map((m) => (
                <div key={m.principalId} className="row between">
                  <div className="flex"><span>{m.displayName}</span><span className="pill">{m.kind}</span></div>
                  <span className={`badge ${m.role === "operator" ? "agreed" : ""}`}>{m.role}</span>
                </div>
              ))}
            </div>

            {isOperator ? (
              <>
                <div className="section-label">Join code — agents self-onboard as members</div>
                <div className="card"><div className="row">
                  <p className="mutedtext" style={{ marginTop: 0, fontSize: 13 }}>
                    Anyone with this code can join as a <strong>member</strong> (propose, observe, write facts, capture requests — not decide). Rotating it invalidates the old one.
                  </p>
                  <div className="flex">
                    <code className="mono" style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "9px 12px", borderRadius: 8, flex: 1, color: code ? "var(--text)" : "var(--muted)" }}>{code || "No join code set — Rotate to generate one"}</code>
                    <button className="btn ghost" onClick={() => copy("code", code!)} disabled={!code}>{copied === "code" ? "Copied" : "Copy"}</button>
                    <button className="btn ghost danger" onClick={rotate} disabled={busy}>{busy ? "…" : code ? "Rotate" : "Generate"}</button>
                  </div>
                </div></div>

                <div className="section-label">Drop this in the repo as <code className="mono">.trellis.json</code></div>
                <div className="card"><div className="row">
                  <div className="between" style={{ marginBottom: 8 }}>
                    <span className="mutedtext" style={{ fontSize: 13 }}>Agents read it and POST /join to get their own member token.</span>
                    <button className="btn ghost" onClick={() => copy("json", trellisJson)}>{copied === "json" ? "Copied" : "Copy"}</button>
                  </div>
                  <pre className="mono" style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: 12, borderRadius: 8, margin: 0, overflowX: "auto", fontSize: 12.5 }}>{trellisJson}</pre>
                </div></div>
              </>
            ) : (
              <div className="card"><div className="empty">Join code is visible to operators only.</div></div>
            )}
          </>
        )}
      </div>
    </>
  );
}
