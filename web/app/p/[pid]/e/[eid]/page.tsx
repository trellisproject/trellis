"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, targetLabel, type EffortDetail, type Member } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { BackButton } from "@/components/BackButton";
import { DeadlineModal } from "@/components/DeadlineModal";
import { AssertionPickerModal } from "@/components/AssertionPickerModal";

const STATUSES = ["active", "next", "someday", "done"] as const;

export default function EffortDetailPage({ params }: { params: Promise<{ pid: string; eid: string }> }) {
  const { pid, eid } = use(params);
  const [d, setD] = useState<EffortDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [dating, setDating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [desc, setDesc] = useState("");

  async function load() {
    const r = await api.get<EffortDetail>(`/projects/${pid}/efforts/${eid}`).catch(() => null);
    setD(r); setDesc(r?.effort.description ?? ""); setLoading(false);
  }
  useEffect(() => { load(); }, [pid, eid]);
  useEffect(() => { api.get<{ members: Member[] }>(`/projects/${pid}/members`).then((r) => setMembers(r.members)).catch(() => {}); }, [pid]);

  async function patch(body: Record<string, unknown>) { await api.patch(`/projects/${pid}/efforts/${eid}`, body); load(); }
  async function addTask() {
    if (!newTask.trim()) return;
    await api.post(`/projects/${pid}/tasks`, { title: newTask.trim(), effort_id: eid });
    setNewTask(""); load();
  }

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Effort not found.</div></div>;
  const e = d.effort;
  const pct = e.progress.total === 0 ? 0 : Math.round((e.progress.verified / e.progress.total) * 100);
  const count = (s: string) => d.assertions.filter((a) => a.status === s).length;

  return (
    <>
      <div className="topbar">
        <BackButton fallback={`/p/${pid}/roadmap`} />
        <h1 style={{ marginLeft: 8 }}>{e.title}</h1>
        <span className="pill" style={{ textTransform: "capitalize" }}>{e.goalType}</span>
        {e.dueInDays != null && e.dueSoon && <span className="pill" style={{ color: e.commitment ? "var(--red)" : "var(--muted)", borderColor: e.commitment ? "var(--red)" : undefined }}>{e.commitment ? "⏰ " : ""}due {e.dueInDays}d</span>}
      </div>
      <div className="content">
        {/* Controls */}
        <div className="card"><div className="row">
          <div className="flex" style={{ gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <label className="flex" style={{ gap: 6 }}><span className="mutedtext">Attention</span>
              <select className="mini-select" value={e.status} onChange={(ev) => patch({ status: ev.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <label className="flex" style={{ gap: 6 }}><span className="mutedtext">Owner</span>
              <select className="mini-select" value={e.ownerId ?? ""} onChange={(ev) => patch({ owner_id: ev.target.value || null })}>
                <option value="">unowned</option>{members.map((m) => <option key={m.principalId} value={m.principalId}>{m.name}</option>)}
              </select>
            </label>
            <label className="flex" style={{ gap: 6 }}><span className="mutedtext">Deadline</span>
              <button className="mini-select" onClick={() => setDating(true)} style={{ cursor: "pointer", color: e.targetDate ? (e.commitment ? "var(--red)" : "var(--text)") : "var(--muted)" }}>{e.targetDate ? `${e.targetDate}${e.commitment ? " · commitment" : ""}` : "+ set"}</button>
            </label>
          </div>
        </div></div>

        {/* Reconciliation */}
        <div className="card"><div className="row">
          <div className="flex" style={{ gap: 16, marginBottom: e.goalType === "checklist" ? 8 : 0, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ color: "var(--green)", fontWeight: 600 }}>{count("verified")} verified</span>
            {count("drifted") > 0 && <span style={{ color: "var(--red)", fontWeight: 600 }}>{count("drifted")} drifted</span>}
            {count("proposed") > 0 && <span className="mutedtext">{count("proposed")} proposed</span>}
            {(count("agreed") + count("implemented")) > 0 && <span className="mutedtext">{count("agreed") + count("implemented")} in progress</span>}
            <span className="mutedtext" style={{ marginLeft: "auto" }}>{d.assertions.length} assertions · {d.tasks.length} tasks</span>
          </div>
          {e.goalType === "checklist" && <div className="progress"><span style={{ width: `${pct}%` }} /></div>}
          {e.goalType === "metric" && <div className="mutedtext" style={{ fontSize: 13 }}>Metric goal: <span style={{ color: "var(--text)" }}>{e.goalTarget || "(set a target)"}</span></div>}
        </div></div>

        {/* Description */}
        <div className="section-label">Description</div>
        <div className="card"><div className="row">
          <textarea className="input" rows={3} value={desc} onChange={(ev) => setDesc(ev.target.value)} placeholder="What this area is — its scope, goals, links, context…" />
          {desc !== (e.description ?? "") && (
            <div className="flex" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => patch({ description: desc })}>Save</button>
              <button className="btn ghost" onClick={() => setDesc(e.description ?? "")}>Revert</button>
            </div>
          )}
        </div></div>

        {/* Assertions */}
        <div className="section-label">Assertions ({d.assertions.length}) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.7, marginLeft: 6 }}>the invariants this area must hold</span>
          <button className="mini-select" style={{ float: "right", cursor: "pointer" }} onClick={() => setAdding(true)}>+ Add</button>
        </div>
        <div className="card">
          {d.assertions.length === 0 ? <div className="empty" style={{ padding: 24 }}>No assertions yet — add the invariants this area must hold.</div> :
            d.assertions.map((a) => (
              <Link key={a.humanId} href={`/p/${pid}/a/${a.humanId}`} className="row between" style={{ display: "flex" }}>
                <div className="flex" style={{ minWidth: 0 }}><span className="aid">{a.humanId}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span></div>
                <div className="flex">
                  {a.metricKey && <span className="mono" style={{ fontSize: 12.5 }}><span style={{ color: a.status === "verified" ? "var(--green)" : a.status === "drifted" ? "var(--red)" : "var(--muted)", fontWeight: 600 }}>{a.latestValue != null ? `${a.latestValue}${a.metricUnit ?? ""}` : "—"}</span><span className="mutedtext"> / {targetLabel(a)}</span></span>}
                  <Badge status={a.status} />
                </div>
              </Link>
            ))}
        </div>

        {/* Tasks */}
        <div className="section-label">Tasks ({d.tasks.length}) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.7, marginLeft: 6 }}>the work in this area</span></div>
        <div className="card">
          {d.tasks.map((t) => (
            <Link key={t.id} href={`/p/${pid}/t/${t.id}`} className="row between" style={{ display: "flex" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: t.status === "done" ? "line-through" : "none", opacity: t.status === "done" ? 0.6 : 1 }}>{t.title}</span>
              <div className="flex">{t.ownerName && <span className="mutedtext" style={{ fontSize: 12 }}>{t.ownerName}</span>}<span className="pill" style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span></div>
            </Link>
          ))}
          <div className="row"><div className="flex" style={{ gap: 8 }}>
            <input className="input" value={newTask} onChange={(ev) => setNewTask(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && addTask()} placeholder="New task in this area…" style={{ flex: 1 }} />
            <button className="btn" onClick={addTask} disabled={!newTask.trim()}>Add</button>
          </div></div>
        </div>

        {/* Decisions */}
        {d.decisions.length > 0 && (
          <>
            <div className="section-label">Decisions ({d.decisions.length}) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, opacity: 0.7, marginLeft: 6 }}>why this area is scoped &amp; dated as it is</span></div>
            <div className="card">
              {d.decisions.map((dec) => (
                <div key={dec.id} className="row"><div className="flex"><span className="pill" style={{ textTransform: "capitalize" }}>{dec.choice}</span><span className="mutedtext" style={{ marginLeft: "auto", fontSize: 12 }}>{new Date(dec.at).toLocaleDateString()}</span></div><div style={{ marginTop: 6, fontSize: 13 }}>{dec.rationale}</div></div>
              ))}
            </div>
          </>
        )}
      </div>

      {dating && <DeadlineModal pid={pid} e={e} onClose={() => setDating(false)} onDone={() => { setDating(false); load(); }} />}
      {adding && (
        <AssertionPickerModal
          pid={pid}
          title={`Add assertions to "${e.title}"`}
          subtitle="Assign intent to this effort. Its progress is computed from these assertions."
          excludeHumanIds={d.assertions.map((a) => a.humanId)}
          requireRationale
          onClose={() => setAdding(false)}
          onSubmit={async (sel, rationale) => { await api.patch(`/projects/${pid}/efforts/${eid}`, { add_assertions: sel, rationale }); setAdding(false); load(); }}
        />
      )}
    </>
  );
}
