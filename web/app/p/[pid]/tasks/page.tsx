"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Task, type Effort, type Member } from "@/lib/api";
import { useScrollRestore } from "@/lib/scroll";

const PRIORITIES = ["now", "normal", "later"] as const;

export default function Tasks({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  useScrollRestore(!loading);

  async function load() {
    const d = await api.get<{ tasks: Task[] }>(`/projects/${pid}/tasks`);
    setTasks(d.tasks); setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);
  useEffect(() => {
    api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`).then((d) => setEfforts(d.efforts)).catch(() => {});
    api.get<{ members: Member[] }>(`/projects/${pid}/members`).then((d) => setMembers(d.members)).catch(() => {});
  }, [pid]);

  return (
    <>
      <div className="topbar">
        <h1>Tasks</h1>
        <span className="sub">The work — build, fix, or standalone operational tasks</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>+ New task</button>
      </div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : tasks.length === 0 ? (
          <div className="card"><div className="empty">No tasks. Create one — it doesn&apos;t need to be tied to an assertion.</div></div>
        ) : (
          <div className="card">
            {tasks.map((t) => (
              <Link key={t.id} href={`/p/${pid}/t/${t.id}`} className="row between" style={{ display: "flex" }}>
                <div className="flex" style={{ minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {t.effortTitle && <span className="pill mutedtext" style={{ fontSize: 12 }}>{t.effortTitle}</span>}
                </div>
                <div className="flex">
                  {t.ownerName && <span className="mutedtext" style={{ fontSize: 12 }}>{t.ownerName}</span>}
                  <span className="pill" style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {creating && <NewTaskModal pid={pid} efforts={efforts} members={members} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setLoading(true); load(); }} />}
    </>
  );
}

function NewTaskModal({ pid, efforts, members, onClose, onDone }: { pid: string; efforts: Effort[]; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [effortId, setEffortId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      await api.post(`/projects/${pid}/tasks`, { title, description, effort_id: effortId || null, owner_id: ownerId || null, priority });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
      <h3>New task</h3>
      <label>Title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sign up for Stripe and get an API key" autoFocus />
      <label>Detail (optional)</label>
      <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing, links, context…" />
      <label>Area (effort) — owner &amp; deadline flow from here</label>
      <select className="input" value={effortId} onChange={(e) => setEffortId(e.target.value)}>
        <option value="">unfiled</option>
        {efforts.map((e) => <option key={e.id} value={e.id}>{e.title}{e.ownerName ? ` · ${e.ownerName}` : ""}</option>)}
      </select>
      <label>Assign to (optional — overrides the area owner)</label>
      <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
        <option value="">{effortId ? "area owner" : "unassigned"}</option>
        {members.map((m) => <option key={m.principalId} value={m.principalId}>{m.name}</option>)}
      </select>
      <label>Priority</label>
      <div className="flex">{PRIORITIES.map((p) => <button key={p} className={`btn ${priority === p ? "primary" : "ghost"}`} onClick={() => setPriority(p)}>{p}</button>)}</div>
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </div></div>
  );
}
