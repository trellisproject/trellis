"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, targetLabel, type Effort, type EffortAssertion, type Member } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { AssertionPickerModal } from "@/components/AssertionPickerModal";
import { useScrollRestore } from "@/lib/scroll";
import { DeadlineModal } from "@/components/DeadlineModal";

function DueBadge({ e }: { e: Effort }) {
  if (e.dueInDays == null || !e.dueSoon) return null;
  return (
    <span className="pill" style={{ color: e.commitment ? "var(--red)" : "var(--muted)", borderColor: e.commitment ? "var(--red)" : undefined, whiteSpace: "nowrap" }}>
      {e.commitment ? "⏰ " : ""}{e.dueInDays <= 0 ? "due now" : `due in ${e.dueInDays}d`}
    </span>
  );
}

const GROUPS: { status: Effort["status"]; label: string }[] = [
  { status: "active", label: "Active — focus now" },
  { status: "next", label: "Next" },
  { status: "someday", label: "Someday" },
  { status: "done", label: "Done" },
];

export default function Roadmap({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [efforts, setEfforts] = useState<Effort[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [datingEffort, setDatingEffort] = useState<Effort | null>(null);
  useScrollRestore(!loading);

  async function load() {
    const d = await api.get<{ efforts: Effort[] }>(`/projects/${pid}/efforts`);
    setEfforts(d.efforts);
    setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);
  useEffect(() => { api.get<{ members: Member[] }>(`/projects/${pid}/members`).then((d) => setMembers(d.members)).catch(() => {}); }, [pid]);

  const [addingTo, setAddingTo] = useState<Effort | null>(null);

  async function setStatus(e: Effort, status: Effort["status"]) {
    await api.patch(`/projects/${pid}/efforts/${e.id}`, { status });
    load();
  }
  async function setOwner(e: Effort, ownerId: string) {
    await api.patch(`/projects/${pid}/efforts/${e.id}`, { owner_id: ownerId || null });
    load();
  }
  // Reorder within a status group: drop `fromId` at `toId`'s slot, renumber the
  // group's `order` (a fluid PATCH — no decision). Optimistic, then reload.
  async function reorder(groupItems: Effort[], fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = groupItems.map((e) => e.id);
    const from = ids.indexOf(fromId), to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    const byId = new Map(groupItems.map((e) => [e.id, e]));
    setEfforts((prev) => [...prev.filter((e) => !byId.has(e.id)), ...next.map((id, i) => ({ ...byId.get(id)!, order: i }))]);
    await Promise.all(next.map((id, i) => (byId.get(id)!.order !== i ? api.patch(`/projects/${pid}/efforts/${id}`, { order: i }) : null)).filter(Boolean));
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
        ) : (
          <>
            {efforts.some((e) => e.dueSoon) && (
              <div>
                <div className="section-label" style={{ color: "var(--red)" }}>⏰ Due soon — commitments pulled into focus · {efforts.filter((e) => e.dueSoon).length}</div>
                {efforts.filter((e) => e.dueSoon).map((e) => <EffortCard key={e.id} pid={pid} e={e} members={members} onStatus={setStatus} onOwner={setOwner} onAdd={() => setAddingTo(e)} onDeadline={() => setDatingEffort(e)} />)}
              </div>
            )}
            {GROUPS.map((g) => {
              const items = efforts.filter((e) => e.status === g.status && !e.dueSoon);
              if (items.length === 0) return null;
              return (
                <div key={g.status}>
                  <div className="section-label">{g.label} · {items.length}</div>
                  {items.map((e) => (
                    <div key={e.id}
                      onDragOver={(ev) => { if (dragId && dragId !== e.id) ev.preventDefault(); }}
                      onDrop={() => { if (dragId) reorder(items, dragId, e.id); setDragId(null); }}
                      style={{ opacity: dragId === e.id ? 0.4 : 1 }}>
                      <EffortCard pid={pid} e={e} members={members} onStatus={setStatus} onOwner={setOwner} onAdd={() => setAddingTo(e)} onDeadline={() => setDatingEffort(e)} drag={{ onStart: () => setDragId(e.id), onEnd: () => setDragId(null) }} />
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>
      {creating && <CreateEffortModal pid={pid} members={members} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setLoading(true); load(); }} />}
      {datingEffort && <DeadlineModal pid={pid} e={datingEffort} onClose={() => setDatingEffort(null)} onDone={() => { setDatingEffort(null); load(); }} />}
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

const STATUSES = ["active", "next", "someday", "done"] as const;

function EffortCard({ pid, e, members, onStatus, onOwner, onAdd, onDeadline, drag }: { pid: string; e: Effort; members: Member[]; onStatus: (e: Effort, s: Effort["status"]) => void; onOwner: (e: Effort, ownerId: string) => void; onAdd: () => void; onDeadline: () => void; drag?: { onStart: () => void; onEnd: () => void } }) {
  const pct = e.progress.total === 0 ? 0 : Math.round((e.progress.verified / e.progress.total) * 100);
  return (
    <div className="card">
      <div className="row">
        {/* Title */}
        <div className="flex" style={{ minWidth: 0, marginBottom: 10 }}>
          {drag && <span draggable onDragStart={drag.onStart} onDragEnd={drag.onEnd} title="Drag to reorder" style={{ cursor: "grab", color: "var(--muted)", userSelect: "none", fontSize: 15, lineHeight: 1 }}>⠿</span>}
          <Link href={`/p/${pid}/e/${e.id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>{e.title}</strong></Link>
          <span className="pill" style={{ textTransform: "capitalize" }}>{e.goalType}</span>
          <DueBadge e={e} />
        </div>

        {/* Meta: attention · owner · deadline */}
        <div className="flex" style={{ gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 13, paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <label className="flex" style={{ gap: 6 }}>
            <span className="mutedtext">Attention</span>
            <select className="mini-select" value={e.status} onChange={(ev) => onStatus(e, ev.target.value as Effort["status"])}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex" style={{ gap: 6 }}>
            <span className="mutedtext">Owner</span>
            <select className="mini-select" value={e.ownerId ?? ""} onChange={(ev) => onOwner(e, ev.target.value)}>
              <option value="">unowned</option>
              {members.map((m) => <option key={m.principalId} value={m.principalId}>{m.name}</option>)}
            </select>
          </label>
          <label className="flex" style={{ gap: 6 }}>
            <span className="mutedtext">Deadline</span>
            <button className="mini-select" onClick={onDeadline} title="Set or change the deadline (a decision)" style={{ cursor: "pointer", color: e.targetDate ? (e.commitment ? "var(--red)" : "var(--text)") : "var(--muted)" }}>
              {e.targetDate ? `${e.targetDate}${e.commitment ? " · commitment" : ""}` : "+ set"}
            </button>
          </label>
        </div>

        {/* Progress / goal */}
        {e.goalType === "metric" ? (
          e.assertions.length === 0 ? (
            <div className="mutedtext" style={{ fontSize: 13 }}>Goal: <span style={{ color: "var(--text)" }}>{e.goalTarget || "(set a target)"}</span><span style={{ marginLeft: 10, opacity: 0.7 }}>· add a metric assertion to track it live</span></div>
          ) : (
            <span className="mutedtext" style={{ fontSize: 13 }}>{e.progress.verified} of {e.progress.total} metrics on target</span>
          )
        ) : e.goalType === "open" ? (
          <div className="mutedtext" style={{ fontSize: 13 }}>Open-ended · {e.assertions.length} assertion{e.assertions.length === 1 ? "" : "s"} · ship increments as they come</div>
        ) : (
          <>
            <div className="mutedtext" style={{ fontSize: 13, marginBottom: 6 }}>{e.progress.verified} of {e.progress.total} verified</div>
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          </>
        )}
      </div>

      {/* Assertions */}
      {e.assertions.map((a) => (
        <Link key={a.humanId} href={`/p/${pid}/a/${a.humanId}`} className="row between" style={{ display: "flex" }}>
          <div className="flex" style={{ minWidth: 0 }}><span className="aid">{a.humanId}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span></div>
          <div className="flex">
            {a.metricKey && (
              <span className="mono" style={{ fontSize: 12.5 }}>
                <span style={{ color: a.status === "verified" ? "var(--green)" : a.status === "drifted" ? "var(--red)" : "var(--muted)", fontWeight: 600 }}>{a.latestValue != null ? `${a.latestValue}${a.metricUnit ?? ""}` : "—"}</span>
                <span className="mutedtext"> / {targetLabel(a)}</span>
              </span>
            )}
            <Badge status={a.status} />
            <span className="mutedtext">→</span>
          </div>
        </Link>
      ))}

      <div className="row"><button className="btn ghost" style={{ fontSize: 13 }} onClick={onAdd}>+ Add assertions</button></div>
    </div>
  );
}

function CreateEffortModal({ pid, members, onClose, onDone }: { pid: string; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Effort["status"]>("next");
  const [goalType, setGoalType] = useState<Effort["goalType"]>("checklist");
  const [goalTarget, setGoalTarget] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [commitment, setCommitment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      await api.post(`/projects/${pid}/efforts`, {
        title, status, goal_type: goalType, goal_target: goalType === "metric" ? goalTarget : null,
        owner_id: ownerId || null, target_date: targetDate || null, commitment,
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>New effort</h3>
      <label>What are you focusing on?</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extraction accuracy" />
      <label>Owner (the person who owns this area end to end)</label>
      <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
        <option value="">unowned</option>
        {members.map((m) => <option key={m.principalId} value={m.principalId}>{m.name}</option>)}
      </select>
      <label>Attention</label>
      <div className="flex">{(["active", "next", "someday"] as const).map((s) => <button key={s} className={`btn ${status === s ? "primary" : "ghost"}`} onClick={() => setStatus(s)}>{s}</button>)}</div>
      <label>Goal</label>
      <div className="flex">{(["checklist", "metric", "open"] as const).map((g) => <button key={g} className={`btn ${goalType === g ? "primary" : "ghost"}`} onClick={() => setGoalType(g)}>{g}</button>)}</div>
      {goalType === "metric" && (<><label>Metric target</label><input className="input" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="≥ 95% on ACORD-125" /></>)}
      <label>Deadline (optional — most efforts don't need one)</label>
      <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      {targetDate && (
        <label className="flex" style={{ fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={commitment} onChange={(e) => setCommitment(e.target.checked)} /> Client commitment — pull it into focus ~a week ahead
        </label>
      )}
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </div></div>
  );
}
