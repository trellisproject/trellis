"use client";
import { useState } from "react";

// A decision needs a rationale (it's the record). Used for agree/retire from
// the detail and spec pages. body is optional supporting context (e.g. the
// statement you're agreeing to) shown above the rationale field.
export function RationaleModal({
  title, body, confirmLabel, placeholder, onClose, onConfirm,
}: {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  placeholder?: string;
  onClose: () => void;
  onConfirm: (rationale: string) => Promise<void>;
}) {
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true); setError("");
    try { await onConfirm(rationale.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
      <h3>{title}</h3>
      {body && <div className="card" style={{ marginBottom: 12 }}><div className="row" style={{ fontSize: 13 }}>{body}</div></div>}
      <label>Rationale (required — the decision record)</label>
      <textarea className="input" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={placeholder ?? "Why?"} autoFocus />
      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      <div className="between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={go} disabled={busy || !rationale.trim()}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </div></div>
  );
}
