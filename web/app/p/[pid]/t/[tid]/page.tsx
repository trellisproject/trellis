"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type TaskDetail, type Effort, type Member } from "@/lib/api";

const STATUSES = ["open", "in_progress", "done", "blocked"] as const;

export default function TaskPage({ params }: { params: Promise<{ pid: string; tid: string }> }) {
  const { pid, tid } = use(params);
  const [d, setD] = useState<TaskDetail | null>(null);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const detail = await api.get<TaskDetail>(`/tasks/${tid}`);
    setD(detail); setDesc(detail.task.description ?? ""); setLoading(false);
  }
  useEffect(() => { load(); }, [pid, tid]);
  useEffect(() => {
    api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`).then((r) => setEfforts(r.efforts)).catch(() => {});
    api.get<{ members: Member[] }>(`/projects/${pid}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [pid]);

  async function patch(body: Record<string, unknown>) {
    await api.patch(`/projects/${pid}/tasks/${tid}`, body);
    load();
  }

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Task not found.</div></div>;
  const t = d.task;

  return (
    <>
      <div className="topbar">
        <Link href={`/p/${pid}/tasks`} className="mutedtext" style={{ fontSize: 13 }}>← Tasks</Link>
        <h1 style={{ marginLeft: 8 }}>{t.title}</h1>
        <span className="pill" style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span>
      </div>
      <div className="content">
        <div className="card"><div className="row">
          <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
            <div className="flex">{STATUSES.map((s) => <button key={s} className={`btn ${t.status === s ? "primary" : "ghost"}`} onClick={() => patch({ status: s })} style={{ textTransform: "capitalize" }}>{s.replace("_", " ")}</button>)}</div>
            <div className="flex">
              <select className="mini-select" value={t.effortId ?? ""} onChange={(e) => patch({ effort_id: e.target.value || null })} title="Area">
                <option value="">unfiled</option>
                {efforts.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
              <select className="mini-select" value={t.ownerId ?? ""} onChange={(e) => patch({ owner_id: e.target.value || null })} title="Owner">
                <option value="">{t.effortId ? "area owner" : "unassigned"}</option>
                {members.map((m) => <option key={m.principalId} value={m.principalId}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div></div>

        <div className="section-label">Detail</div>
        <div className="card"><div className="row">
          <textarea className="input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What needs doing, links, context…" />
          {desc !== (t.description ?? "") && (
            <div className="flex" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => patch({ description: desc })}>Save</button>
              <button className="btn ghost" onClick={() => setDesc(t.description ?? "")}>Revert</button>
            </div>
          )}
        </div></div>

        <div className="section-label">Linked intent</div>
        <div className="card">
          {d.assertions.length === 0 ? <div className="empty" style={{ padding: 24 }}>No linked assertions — this is standalone work.</div> :
            d.assertions.map((a) => (
              <Link key={a.id} href={`/p/${pid}/a/${a.humanId}`} className="row between" style={{ display: "flex" }}>
                <div className="flex" style={{ minWidth: 0 }}><span className="aid">{a.humanId}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span></div>
                <span className="mutedtext">→</span>
              </Link>
            ))}
        </div>

        <div className="section-label">Checkpoints — resumable progress</div>
        <div className="card">
          {d.checkpoints.length === 0 ? <div className="empty" style={{ padding: 24 }}>No checkpoints yet.</div> :
            d.checkpoints.map((cp) => (
              <div key={cp.id} className="row between"><span>{cp.note}</span><span className="mutedtext" style={{ fontSize: 12 }}>{new Date(cp.at).toLocaleString()}</span></div>
            ))}
        </div>
      </div>
    </>
  );
}
