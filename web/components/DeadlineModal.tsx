"use client";
import { useState } from "react";
import { api, type Effort } from "@/lib/api";

// Set / change / clear an effort's deadline. A date change is a decision
// (rationale required, server-enforced); a commitment-only toggle stays fluid.
export function DeadlineModal({ pid, e, onClose, onDone }: { pid: string; e: Pick<Effort, "id" | "title" | "targetDate" | "commitment">; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(e.targetDate ?? "");
  const [commitment, setCommitment] = useState(e.commitment);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dateChanged = (date || "") !== (e.targetDate ?? "");
  async function save(clear: boolean) {
    setBusy(true); setError("");
    try {
      const changesDate = clear ? !!e.targetDate : dateChanged;
      await api.patch(`/projects/${pid}/efforts/${e.id}`, { target_date: clear ? null : (date || null), commitment: clear ? false : commitment, rationale: changesDate ? why : undefined });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(ev) => ev.stopPropagation()}>
      <h3>Deadline — {e.title}</h3>
      <label>Date</label>
      <input className="input" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} autoFocus />
      <label className="flex" style={{ fontSize: 13, cursor: "pointer", marginTop: 4 }}>
        <input type="checkbox" checked={commitment} onChange={(ev) => setCommitment(ev.target.checked)} /> Client commitment — pull into focus ~a week ahead
      </label>
      <label>Rationale{dateChanged ? " (required — changing a date is a decision)" : " (optional)"}</label>
      <textarea className="input" rows={2} value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="Why this date?" />
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        {e.targetDate ? <button className="btn ghost" onClick={() => save(true)} disabled={busy || !why.trim()} style={{ color: "var(--red)" }}>Clear deadline</button> : <span />}
        <div className="flex">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => save(false)} disabled={busy || !date || (dateChanged && !why.trim())}>Save</button>
        </div>
      </div>
    </div></div>
  );
}
