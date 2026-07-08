"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Spec } from "@/lib/api";
import { SpecsTabs } from "@/components/SpecsTabs";

export default function Specs({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    const d = await api.get<{ specs: Spec[] }>(`/projects/${pid}/specs`);
    setSpecs(d.specs); setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);

  return (
    <>
      <div className="topbar">
        <SpecsTabs pid={pid} current="specs" />
        <span className="sub">Structured intent — authored in Trellis, mirrored to git</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>+ New spec</button>
      </div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : specs.length === 0 ? (
          <div className="card"><div className="empty">No specs yet. Create one to start authoring intent.</div></div>
        ) : (
          <div className="card">
            {specs.map((s) => (
              <Link key={s.id} href={`/p/${pid}/specs/${s.slug}`} className="row between" style={{ display: "flex" }}>
                <div className="stack"><strong>{s.title}</strong><span className="assertion-id">{s.slug} · v{s.version}</span></div>
                <span className="mutedtext">→</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {creating && <NewSpecModal pid={pid} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setLoading(true); load(); }} />}
    </>
  );
}

function NewSpecModal({ pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await api.post(`/projects/${pid}/specs`, { slug, title, code }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>New spec</h3>
      <label>Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extraction Core" />
      <label>Slug (lowercase-kebab, used in the URL and the mirror filename)</label>
      <input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="extraction-core" />
      <label>Assertion ID prefix</label>
      <input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KOJI-EXT" />
      <p className="mutedtext" style={{ fontSize: 12 }}>Assertions get IDs like <code className="mono">{code || "KOJI-EXT"}-001</code>.</p>
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim() || !slug.trim() || !code.trim()}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </div></div>
  );
}
