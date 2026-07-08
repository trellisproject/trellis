"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type DiagramSummary } from "@/lib/api";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/diagram";
import { SpecsTabs } from "@/components/SpecsTabs";

export default function MapIndex({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const router = useRouter();
  const [diagrams, setDiagrams] = useState<DiagramSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  async function load() { const d = await api.get<{ diagrams: DiagramSummary[] }>(`/projects/${pid}/diagrams`); setDiagrams(d.diagrams); }
  useEffect(() => { load(); }, [pid]);

  async function create() {
    if (!title.trim()) return;
    const r = await api.post<{ diagram: { key: string } }>(`/projects/${pid}/diagrams`, { title: title.trim() });
    router.push(`/p/${pid}/map/${r.diagram.key}`);
  }

  const roots = (diagrams ?? []).filter((d) => d.isRoot);
  return (
    <>
      <div className="topbar">
        <SpecsTabs pid={pid} current="map" />
        <span className="sub">Visual flows over the specs — drill from the whole system down to each workflow, colored by drift.</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>+ New map</button>
      </div>
      <div className="content">
        {!diagrams ? <div className="empty">Loading…</div> : roots.length === 0 ? (
          <div className="card"><div className="empty">No maps yet. Chart a workflow, anchor its steps to specs, and it colors itself by drift.</div></div>
        ) : roots.map((d) => (
          <Link key={d.id} href={`/p/${pid}/map/${d.key}`} className="card" style={{ display: "block" }}>
            <div className="row between">
              <div className="flex"><span className="statusdot" style={{ background: STATUS_COLOR[d.status] }} /><strong>{d.title}</strong></div>
              <span className="mutedtext" style={{ fontSize: 13 }}>{d.nodeCount} node{d.nodeCount === 1 ? "" : "s"} · {STATUS_LABEL[d.status]}</span>
            </div>
          </Link>
        ))}
      </div>
      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>New map</h3>
          <label>Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intake pipeline" autoFocus onKeyDown={(e) => e.key === "Enter" && create()} />
          <div className="between" style={{ marginTop: 16 }}><button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" onClick={create} disabled={!title.trim()}>Create</button></div>
        </div></div>
      )}
    </>
  );
}
