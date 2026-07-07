"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, metricLabel, type Assertion, type Spec } from "@/lib/api";
import { Badge } from "@/components/Badge";

export default function SpecDetail({ params }: { params: Promise<{ pid: string; slug: string }> }) {
  const { pid, slug } = use(params);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Assertion | "new" | null>(null);

  async function load() {
    const d = await api.get<{ spec: Spec; assertions: Assertion[] }>(`/projects/${pid}/specs/${slug}`);
    setSpec(d.spec); setAssertions(d.assertions); setLoading(false);
  }
  useEffect(() => { load(); }, [pid, slug]);

  return (
    <>
      <div className="topbar">
        <h1>{spec?.title ?? slug}</h1>
        <span className="sub">{assertions.length} assertions · authored here, mirrored to git</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setEditing("new")}>+ New assertion</button>
      </div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : (
          <div className="card">
            {assertions.length === 0 && <div className="empty" style={{ padding: 28 }}>No assertions yet. Add the first one.</div>}
            {assertions.map((a) => (
              <div key={a.id} className="row" style={{ borderLeft: a.status === "drifted" ? "3px solid var(--red)" : "3px solid transparent" }}>
                <div className="between">
                  <Link href={`/p/${pid}/a/${a.humanId}`} className="flex" style={{ minWidth: 0 }}><span className="assertion-id">{a.humanId}</span><strong>{a.title}</strong></Link>
                  <div className="flex">
                    {a.metricKey && <span className="pill mono" style={{ color: "var(--violet)" }}>{metricLabel(a)}</span>}
                    <Badge status={a.status} />
                    <button className="mini-select" onClick={() => setEditing(a)}>edit</button>
                  </div>
                </div>
                <div className="mutedtext" style={{ fontSize: 13, marginTop: 6 }}>{a.statement}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <AssertionEditor pid={pid} slug={slug} existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); setLoading(true); load(); }} />}
    </>
  );
}

function AssertionEditor({ pid, slug, existing, onClose, onDone }: { pid: string; slug: string; existing: Assertion | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [statement, setStatement] = useState(existing?.statement ?? "");
  const [metric, setMetric] = useState(existing?.metricKey ? metricLabel(existing)!.replace(/^(\S+)\s*(≥|>|≤|<|=)\s*/, (_, k, op) => `${k} ${({ "≥": ">=", "≤": "<=" } as Record<string, string>)[op] ?? op} `) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      const metricVal = metric.trim() ? metric.trim() : null;
      if (existing) {
        await api.patch(`/projects/${pid}/assertions/${existing.humanId}`, { title, statement, metric: metricVal });
      } else {
        await api.post(`/projects/${pid}/specs/${slug}/assertions`, { title, statement, metric: metricVal });
      }
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
      <h3>{existing ? `Edit ${existing.humanId}` : "New assertion"}</h3>
      <label>Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Idempotent charge creation" />
      <label>Statement (normative — must / always / never)</label>
      <textarea className="input" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="POST /charges accepts an Idempotency-Key and returns the original charge on retry." />
      <label>Metric (optional) — <code className="mono">key &gt;= target[unit]</code></label>
      <input className="input mono" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="extraction.accuracy.acord-125 >= 95%" />
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim() || !statement.trim()}>{busy ? "Saving…" : existing ? "Save" : "Create"}</button>
      </div>
    </div></div>
  );
}
