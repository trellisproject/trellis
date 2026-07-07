"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Effort } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { AssertionPickerModal } from "@/components/AssertionPickerModal";

const GROUPS: { status: Effort["status"]; label: string }[] = [
  { status: "active", label: "Active — focus now" },
  { status: "next", label: "Next" },
  { status: "someday", label: "Someday" },
  { status: "done", label: "Done" },
];

export default function Roadmap({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    const d = await api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`);
    setEfforts(d.efforts);
    setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);

  const [addingTo, setAddingTo] = useState<Effort | null>(null);

  async function setStatus(e: Effort, status: Effort["status"]) {
    await api.patch(`/projects/${pid}/efforts/${e.id}`, { status });
    load();
  }

  return (
    <>
      <div className="topbar">
        <h1>Roadmap</h1>
        <span className="sub">Major efforts, ordered by attention — not dated releases. Ship increments under the active effort.</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>+ New effort</button>
      </div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : efforts.length === 0 ? (
          <div className="card"><div className="empty">No efforts yet. Name a major effort to focus on.</div></div>
        ) : GROUPS.map((g) => {
          const items = efforts.filter((e) => e.status === g.status);
          if (items.length === 0) return null;
          return (
            <div key={g.status}>
              <div className="section-label">{g.label} · {items.length}</div>
              {items.map((e) => <EffortCard key={e.id} pid={pid} e={e} onStatus={setStatus} onAdd={() => setAddingTo(e)} />)}
            </div>
          );
        })}
      </div>
      {creating && <CreateEffortModal pid={pid} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setLoading(true); load(); }} />}
      {addingTo && (
        <AssertionPickerModal
          pid={pid}
          title={`Add assertions to "${addingTo.title}"`}
          subtitle="Assign intent to this effort. Its progress is computed from these assertions."
          excludeHumanIds={addingTo.assertions.map((a) => a.humanId)}
          requireRationale
          onClose={() => setAddingTo(null)}
          onSubmit={async (sel, rationale) => { await api.patch(`/projects/${pid}/efforts/${addingTo.id}`, { add_assertions: sel, rationale }); setAddingTo(null); load(); }}
        />
      )}
    </>
  );
}

function EffortCard({ pid, e, onStatus, onAdd }: { pid: string; e: Effort; onStatus: (e: Effort, s: Effort["status"]) => void; onAdd: () => void }) {
  const pct = e.progress.total === 0 ? 0 : Math.round((e.progress.verified / e.progress.total) * 100);
  return (
    <div className="card">
      <div className="row">
        <div className="between" style={{ marginBottom: 10 }}>
          <div className="flex"><strong>{e.title}</strong><span className="pill" style={{ textTransform: "capitalize" }}>{e.goalType}</span></div>
          <div className="flex">
            {e.goalType !== "metric" && <button className="btn ghost" onClick={onAdd}>+ Add assertions</button>}
            <select className="mini-select" value={e.status} onChange={(ev) => onStatus(e, ev.target.value as Effort["status"])}>
              <option value="active">active</option><option value="next">next</option><option value="someday">someday</option><option value="done">done</option>
            </select>
          </div>
        </div>
        {e.goalType === "metric" ? (
          <div className="mutedtext" style={{ fontSize: 13 }}>Goal: <span style={{ color: "var(--text)" }}>{e.goalTarget || "(set a target)"}</span><span style={{ marginLeft: 10, opacity: 0.7 }}>· metric tracking arrives with metric assertions</span></div>
        ) : e.goalType === "open" ? (
          <div className="mutedtext" style={{ fontSize: 13 }}>Open-ended · {e.assertions.length} assertion{e.assertions.length === 1 ? "" : "s"} · ship increments as they come</div>
        ) : (
          <>
            <div className="between" style={{ marginBottom: 6 }}>
              <span className="mutedtext" style={{ fontSize: 13 }}>{e.progress.verified} of {e.progress.total} verified</span>
              {e.targetDate && <span className="mutedtext" style={{ fontSize: 12 }}>target {e.targetDate}</span>}
            </div>
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          </>
        )}
      </div>
      {e.assertions.map((a) => (
        <Link key={a.humanId} href={`/p/${pid}/a/${a.humanId}`} className="row between" style={{ display: "flex" }}>
          <div className="flex"><span className="aid">{a.humanId}</span><span>{a.title}</span></div>
          <div className="flex"><Badge status={a.status} /><span className="mutedtext">→</span></div>
        </Link>
      ))}
    </div>
  );
}

function CreateEffortModal({ pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Effort["status"]>("next");
  const [goalType, setGoalType] = useState<Effort["goalType"]>("checklist");
  const [goalTarget, setGoalTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await api.post(`/projects/${pid}/efforts`, { title, status, goal_type: goalType, goal_target: goalType === "metric" ? goalTarget : null }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>New effort</h3>
      <label>What are you focusing on?</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extraction accuracy" />
      <label>Attention</label>
      <div className="flex">{(["active", "next", "someday"] as const).map((s) => <button key={s} className={`btn ${status === s ? "primary" : "ghost"}`} onClick={() => setStatus(s)}>{s}</button>)}</div>
      <label>Goal</label>
      <div className="flex">{(["checklist", "metric", "open"] as const).map((g) => <button key={g} className={`btn ${goalType === g ? "primary" : "ghost"}`} onClick={() => setGoalType(g)}>{g}</button>)}</div>
      {goalType === "metric" && (<><label>Metric target</label><input className="input" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="≥ 95% on ACORD-125" /></>)}
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </div></div>
  );
}
