"use client";
import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getSession } from "@/lib/store";

type Member = { principalId: string; role: string; displayName: string; kind: string };
type Delegation = { id: string; agentPrincipalId: string; decisionClasses: string[]; active: boolean };
type ProjectView = { project: { id: string; name: string; joinCode?: string }; members: Member[] };

const DECISION_CLASSES = [
  { id: "assertion.agree", label: "Agree assertions" },
  { id: "assertion.retire", label: "Retire assertions" },
  { id: "drift.resolve", label: "Resolve drift" },
  { id: "effort.change", label: "Change efforts (scope & dates)" },
  { id: "challenge.resolve", label: "Resolve challenges" },
  { id: "request.decide", label: "Decide requests" },
];

export default function Settings({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [data, setData] = useState<ProjectView | null>(null);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [editingAgent, setEditingAgent] = useState<Member | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const d = await api.get<ProjectView>(`/projects/${pid}`);
    setData(d);
    api.get<{ delegations: Delegation[] }>(`/projects/${pid}/delegations`).then((r) => setDelegations(r.delegations)).catch(() => {});
  }
  useEffect(() => { setApiUrl(getSession()?.apiUrl ?? ""); load(); }, [pid]);

  async function setRole(principalId: string, role: string) {
    setErr("");
    try { await api.patch(`/projects/${pid}/members/${principalId}`, { role }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to change role"); }
  }

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
            <div className="section-label" style={{ marginTop: 0 }}>Members &amp; decision authority ({data.members.length})</div>
            <p className="mutedtext" style={{ fontSize: 13, marginTop: -4 }}>Humans decide by being an <strong>operator</strong>; agents decide only under the <strong>delegated</strong> classes you grant. Everyone can propose, observe, and write facts.</p>
            <div className="card">
              {data.members.map((m) => {
                const granted = delegations.filter((d) => d.active && d.agentPrincipalId === m.principalId).flatMap((d) => d.decisionClasses);
                return (
                  <div key={m.principalId} className="row between">
                    <div className="flex" style={{ minWidth: 0 }}><span>{m.displayName}</span><span className="pill">{m.kind}</span></div>
                    <div className="flex">
                      {m.kind === "human" ? (
                        isOperator ? (
                          <select className="mini-select" value={m.role} onChange={(e) => setRole(m.principalId, e.target.value)}>
                            <option value="member">member — can&apos;t decide</option>
                            <option value="operator">operator — decides</option>
                          </select>
                        ) : <span className={`badge ${m.role === "operator" ? "agreed" : ""}`}>{m.role}</span>
                      ) : (
                        <>
                          <span className="mutedtext" style={{ fontSize: 12 }}>{granted.includes("*") ? "all decisions" : granted.length ? `${granted.length} decision${granted.length === 1 ? "" : "s"}` : "no decisions"}</span>
                          {isOperator && <button className="mini-select" style={{ cursor: "pointer" }} onClick={() => setEditingAgent(m)}>manage</button>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}

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
      {editingAgent && <DelegationModal pid={pid} agent={editingAgent} delegations={delegations} onClose={() => setEditingAgent(null)} onDone={() => { setEditingAgent(null); load(); }} />}
    </>
  );
}

function DelegationModal({ pid, agent, delegations, onClose, onDone }: { pid: string; agent: Member; delegations: Delegation[]; onClose: () => void; onDone: () => void }) {
  const active = delegations.filter((d) => d.active && d.agentPrincipalId === agent.principalId);
  const current = new Set(active.flatMap((d) => d.decisionClasses));
  const [sel, setSel] = useState<Set<string>>(current.has("*") ? new Set(DECISION_CLASSES.map((c) => c.id)) : new Set(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function toggle(id: string) { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); }
  async function save() {
    setBusy(true); setError("");
    try {
      for (const d of active) await api.post(`/projects/${pid}/delegations/${d.id}/revoke`);
      if (sel.size) await api.post(`/projects/${pid}/delegations`, { agent: agent.principalId, classes: [...sel] });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Decision authority — {agent.displayName}</h3>
      <p className="mutedtext" style={{ fontSize: 13, marginTop: 4 }}>This agent can make only the decisions you check. Reversible anytime.</p>
      <div style={{ marginTop: 10 }}>
        {DECISION_CLASSES.map((c) => (
          <label key={c.id} className="flex" style={{ cursor: "pointer", padding: "7px 0", gap: 8 }}>
            <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} style={{ flexShrink: 0 }} />
            <span>{c.label}</span>
            <span className="mutedtext mono" style={{ fontSize: 11, marginLeft: "auto" }}>{c.id}</span>
          </label>
        ))}
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost danger" onClick={() => setSel(new Set())} disabled={sel.size === 0}>Revoke all</button>
        <div className="flex">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div></div>
  );
}
