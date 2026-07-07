"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Request } from "@/lib/api";
import { Badge } from "@/components/Badge";

export default function Requests({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [decide, setDecide] = useState<Request | null>(null);

  async function load() {
    const d = await api.get<{ requests: Request[] }>(`/projects/${pid}/requests`);
    setRequests(d.requests);
    setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);

  function statusPill(r: Request) {
    if (r.shipped) return <span className="badge verified">shipped</span>;
    if (r.status === "accepted") return <span className="badge agreed">accepted</span>;
    if (r.status === "declined") return <span className="badge retired">declined</span>;
    return <span className="badge">new</span>;
  }

  return (
    <>
      <div className="topbar">
        <h1>Requests</h1>
        <span className="sub">Capture an ask → accept it → derive intent → ships when that intent is verified</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>+ New request</button>
      </div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : requests.length === 0 ? (
          <div className="card"><div className="empty">No requests yet. Capture the first ask.</div></div>
        ) : requests.map((r) => (
          <div key={r.id} className="card">
            <div className="row">
              <div className="between">
                <div className="stack">
                  <div className="flex"><strong>{r.title}</strong>{statusPill(r)}</div>
                  <div className="mutedtext" style={{ fontSize: 13 }}>{r.requester}{r.source ? ` · via ${r.source}` : ""}</div>
                  {r.body && <div className="mutedtext" style={{ fontSize: 13 }}>{r.body}</div>}
                </div>
                {r.status === "new" && <button className="btn" onClick={() => setDecide(r)}>Accept / Decline</button>}
              </div>
            </div>
            {r.derived.length > 0 && (
              <div className="row">
                <div className="section-label" style={{ margin: "0 0 8px" }}>Derived intent · {r.derived.filter((a) => a.status === "verified").length}/{r.derived.length} verified</div>
                {r.derived.map((a) => (
                  <Link key={a.humanId} href={`/p/${pid}/a/${a.humanId}`} className="between" style={{ display: "flex", padding: "5px 0" }}>
                    <div className="flex"><span className="aid">{a.humanId}</span><span>{a.title}</span></div>
                    <Badge status={a.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && <CreateModal pid={pid} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setLoading(true); load(); }} />}
      {decide && <DecideModal pid={pid} req={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); setLoading(true); load(); }} />}
    </>
  );
}

function CreateModal({ pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [requester, setRequester] = useState("");
  const [source, setSource] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await api.post(`/projects/${pid}/requests`, { title, requester, source: source || null, body }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Capture a request</h3>
      <label>What are they asking for?</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bulk CSV export" />
      <label>Who asked?</label>
      <input className="input" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="customer: Acme Corp" />
      <label>Source (optional)</label>
      <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="email, slack, meeting…" />
      <label>Detail (optional)</label>
      <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim() || !requester.trim()}>{busy ? "Capturing…" : "Capture"}</button>
      </div>
    </div></div>
  );
}

function DecideModal({ pid, req, onClose, onDone }: { pid: string; req: Request; onClose: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState<"accept" | "decline">("accept");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await api.post(`/projects/${pid}/requests/${req.id}/decide`, { choice, rationale }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Decide: {req.title}</h3>
      <p className="mutedtext" style={{ fontSize: 13, marginTop: 0 }}>{req.requester}</p>
      <label>Decision</label>
      <div className="flex">
        <button className={`btn ${choice === "accept" ? "primary" : "ghost"}`} onClick={() => setChoice("accept")}>Accept</button>
        <button className={`btn ${choice === "decline" ? "primary" : "ghost"}`} onClick={() => setChoice("decline")}>Decline</button>
      </div>
      <label>Rationale (required — recorded either way)</label>
      <textarea className="input" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={choice === "accept" ? "Why take this on?" : "Why not now?"} />
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !rationale.trim()}>{busy ? "Recording…" : "Record decision"}</button>
      </div>
    </div></div>
  );
}
