"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type DiagramDetail, type DiagramNode, type Effort, type NodeKind } from "@/lib/api";
import { Mermaid } from "@/components/Mermaid";
import { toMermaid, STATUS_COLOR, STATUS_LABEL } from "@/lib/diagram";
import { DescriptionEditor } from "@/components/Description";
import { SpecsTabs } from "@/components/SpecsTabs";

const KINDS: NodeKind[] = ["step", "decision", "trigger", "terminal", "subflow"];
const LEGEND = ["verified", "drifted", "progress", "none"] as const;

export default function DiagramPage({ params }: { params: Promise<{ pid: string; key: string }> }) {
  const { pid, key } = use(params);
  const router = useRouter();
  const [d, setD] = useState<DiagramDetail | null>(null);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nl, setNl] = useState(""); const [nk, setNk] = useState<NodeKind>("step");
  const [ef, setEf] = useState(""); const [et, setEt] = useState(""); const [elabel, setElabel] = useState("");

  async function load() { const r = await api.get<DiagramDetail>(`/projects/${pid}/diagrams/${key}`).catch(() => null); setD(r); setLoading(false); }
  useEffect(() => { load(); setSelected(null); /* eslint-disable-next-line */ }, [pid, key]);
  useEffect(() => { api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`).then((r) => setEfforts(r.efforts)).catch(() => {}); }, [pid]);

  function onNode(k: string) {
    const n = d?.nodes.find((x) => x.key === k); if (!n) return;
    if (mode === "edit") { setSelected(k); return; }
    if (n.childDiagramKey) router.push(`/p/${pid}/map/${n.childDiagramKey}`);
    else if (n.assertionHumanId) router.push(`/p/${pid}/a/${n.assertionHumanId}`);
    else if (n.effortId) router.push(`/p/${pid}/e/${n.effortId}`);
  }
  async function addNode() { if (!nl.trim() || !d) return; await api.post(`/projects/${pid}/diagrams/${d.diagram.id}/nodes`, { label: nl.trim(), kind: nk }); setNl(""); load(); }
  async function addEdge() { if (!ef || !et || !d) return; await api.post(`/projects/${pid}/diagrams/${d.diagram.id}/edges`, { from: ef, to: et, label: elabel || undefined }); setEf(""); setEt(""); setElabel(""); load(); }
  async function patchNode(nid: string, body: Record<string, unknown>) { await api.patch(`/projects/${pid}/nodes/${nid}`, body); load(); }
  async function makeSub(n: DiagramNode) { const r = await api.post<{ diagram: { key: string } }>(`/projects/${pid}/diagrams`, { title: n.label, parent_node_id: n.id }); router.push(`/p/${pid}/map/${r.diagram.key}`); }

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Map not found.</div></div>;
  const sel = d.nodes.find((n) => n.key === selected) ?? null;

  return (
    <>
      <div className="topbar">
        <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
          <SpecsTabs pid={pid} current="map" />
          <span className="mutedtext" style={{ fontSize: 15 }}>›</span>
          {d.breadcrumb.map((b, i) => (
            <span key={b.key} className="flex" style={{ gap: 6 }}>
              {i > 0 && <span className="mutedtext">›</span>}
              {b.key === d.diagram.key ? <strong style={{ fontSize: 15 }}>{b.title}</strong> : <Link href={`/p/${pid}/map/${b.key}`} className="mutedtext" style={{ fontSize: 15 }}>{b.title}</Link>}
            </span>
          ))}
        </div>
        <div className="flex" style={{ marginLeft: "auto", gap: 10 }}>
          {mode === "edit" && (
            <div className="segmented">
              {(["TD", "LR"] as const).map((dir) => <button key={dir} className={d.diagram.direction === dir ? "active" : ""} onClick={() => api.patch(`/projects/${pid}/diagrams/${d.diagram.id}`, { direction: dir }).then(load)}>{dir === "TD" ? "↓" : "→"}</button>)}
            </div>
          )}
          <div className="segmented"><button className={mode === "view" ? "active" : ""} onClick={() => { setMode("view"); setSelected(null); }}>View</button><button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Edit</button></div>
        </div>
      </div>
      <div className="content">
        <div className="card"><div className="row"><Mermaid chart={toMermaid(d)} onNodeClick={onNode} /></div></div>
        <div className="flex" style={{ gap: 16, fontSize: 12, margin: "4px 2px 16px", flexWrap: "wrap" }}>
          {LEGEND.map((s) => <span key={s} className="flex" style={{ gap: 6 }}><span className="statusdot" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>)}
          <span className="mutedtext">· click a node to {mode === "edit" ? "select it" : "drill in / open its spec"} · a double-box drills down</span>
        </div>

        {mode === "view" ? (
          <>
            <div className="section-label">About this flow</div>
            <div className="card"><div className="row"><DescriptionEditor value={d.diagram.description} onSave={(v) => api.patch(`/projects/${pid}/diagrams/${d.diagram.id}`, { description: v }).then(load)} placeholder="What this flow is — and how it maps to the specs." /></div></div>
          </>
        ) : (
          <>
            {sel && (
              <>
                <div className="section-label">Selected: {sel.label}</div>
                <div className="card"><div className="row"><div className="stack" style={{ gap: 12 }}>
                  <div className="flex" style={{ gap: 8 }}>
                    <input className="input" defaultValue={sel.label} key={sel.id + sel.label} onBlur={(e) => e.target.value.trim() && e.target.value !== sel.label && patchNode(sel.id, { label: e.target.value.trim() })} />
                    <select className="mini-select" value={sel.kind} onChange={(e) => patchNode(sel.id, { kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                  </div>
                  <div className="flex" style={{ gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                    <span className="mutedtext">Anchor to spec:</span>
                    <select className="mini-select" value={sel.effortId ?? ""} onChange={(e) => patchNode(sel.id, { effort_id: e.target.value || null, assertion: null })}><option value="">— effort —</option>{efforts.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
                    <input className="input" style={{ maxWidth: 160 }} defaultValue={sel.assertionHumanId ?? ""} key={sel.id + "a"} placeholder="or assertion id" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sel.assertionHumanId ?? "")) patchNode(sel.id, { assertion: v || null, effort_id: null }); }} />
                    {sel.status !== "none" && <span className="flex" style={{ gap: 5 }}><span className="statusdot" style={{ background: STATUS_COLOR[sel.status] }} />{STATUS_LABEL[sel.status]}</span>}
                  </div>
                  <div className="flex" style={{ gap: 8 }}>
                    {sel.childDiagramKey
                      ? <button className="btn" onClick={() => router.push(`/p/${pid}/map/${sel.childDiagramKey}`)}>Open sub-map ⤵</button>
                      : <button className="btn ghost" onClick={() => makeSub(sel)}>Create sub-map ⤵</button>}
                    <button className="btn danger" style={{ marginLeft: "auto" }} onClick={async () => { await api.del(`/projects/${pid}/nodes/${sel.id}`); setSelected(null); load(); }}>Delete node</button>
                  </div>
                </div></div></div>
              </>
            )}
            <div className="section-label">Add node</div>
            <div className="card"><div className="row"><div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              <input className="input" style={{ flex: 1, minWidth: 160 }} value={nl} onChange={(e) => setNl(e.target.value)} placeholder="Node label" onKeyDown={(e) => e.key === "Enter" && addNode()} />
              <select className="mini-select" value={nk} onChange={(e) => setNk(e.target.value as NodeKind)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <button className="btn" onClick={addNode} disabled={!nl.trim()}>Add</button>
            </div></div></div>
            <div className="section-label">Add connection</div>
            <div className="card"><div className="row"><div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              <select className="mini-select" value={ef} onChange={(e) => setEf(e.target.value)}><option value="">from…</option>{d.nodes.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}</select>
              <span className="mutedtext">→</span>
              <select className="mini-select" value={et} onChange={(e) => setEt(e.target.value)}><option value="">to…</option>{d.nodes.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}</select>
              <input className="input" style={{ flex: 1, minWidth: 120 }} value={elabel} onChange={(e) => setElabel(e.target.value)} placeholder="trigger / condition (optional)" />
              <button className="btn" onClick={addEdge} disabled={!ef || !et}>Connect</button>
            </div></div></div>
            {d.edges.length > 0 && (
              <>
                <div className="section-label">Connections</div>
                <div className="card">{d.edges.map((e) => (
                  <div key={e.id} className="row between">
                    <span style={{ fontSize: 13 }}>{d.nodes.find((n) => n.key === e.fromKey)?.label} <span className="mutedtext">{e.label ? `—${e.label}→` : "→"}</span> {d.nodes.find((n) => n.key === e.toKey)?.label}</span>
                    <button className="attach-x" onClick={async () => { await api.del(`/projects/${pid}/edges/${e.id}`); load(); }}>×</button>
                  </div>
                ))}</div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
