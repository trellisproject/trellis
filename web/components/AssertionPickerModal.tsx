"use client";
import { useEffect, useState } from "react";
import { api, type Assertion } from "@/lib/api";
import { Badge } from "./Badge";

// Reusable assertion picker. Used to link assertions to a request (no decision)
// and to add assertions to an effort (a scope decision — requireRationale).
export function AssertionPickerModal({
  pid, title, subtitle, excludeHumanIds, requireRationale, submitLabel, onClose, onSubmit,
}: {
  pid: string;
  title: string;
  subtitle: string;
  excludeHumanIds: string[];
  requireRationale?: boolean;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (selected: string[], rationale: string) => Promise<void>;
}) {
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rationale, setRationale] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ assertions: Assertion[] }>(`/projects/${pid}/assertions`)
      .then((d) => { setAssertions(d.assertions); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); });
  }, [pid]);

  function toggle(h: string) {
    const n = new Set(selected);
    n.has(h) ? n.delete(h) : n.add(h);
    setSelected(n);
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      await onSubmit([...selected], rationale);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  const exclude = new Set(excludeHumanIds);
  const needle = q.trim().toLowerCase();
  const available = assertions.filter((a) => !exclude.has(a.humanId) && (!needle || a.humanId.toLowerCase().includes(needle) || a.title.toLowerCase().includes(needle)));
  const canSubmit = selected.size > 0 && (!requireRationale || rationale.trim().length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>{title}</h3>
        <p className="mutedtext" style={{ fontSize: 13, marginTop: 4 }}>{subtitle}</p>
        {loading ? (
          <div className="empty">Loading assertions…</div>
        ) : assertions.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>No assertions yet. Author them first.</div>
        ) : (
          <>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by id or title…" style={{ marginBottom: 8 }} autoFocus />
            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              {available.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>{needle ? "No matches." : "All assertions are already in this effort."}</div>
              ) : available.map((a) => (
                <label key={a.humanId} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "9px 12px", borderBottom: "1px solid var(--border)" }}>
                  <input type="checkbox" checked={selected.has(a.humanId)} onChange={() => toggle(a.humanId)} style={{ flexShrink: 0 }} />
                  <span className="aid" style={{ flexShrink: 0, whiteSpace: "nowrap", minWidth: 96 }}>{a.humanId}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  <Badge status={a.status} />
                </label>
              ))}
            </div>
            <div className="mutedtext" style={{ fontSize: 12, marginTop: 6 }}>{available.length} shown{selected.size ? ` · ${selected.size} selected` : ""}</div>
          </>
        )}
        {requireRationale && (
          <>
            <label>Rationale (required — a scope change is a decision)</label>
            <textarea className="input" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why bring this into the effort?" />
          </>
        )}
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <div className="between" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !canSubmit}>{busy ? "Working…" : `${submitLabel ?? "Add"} ${selected.size || ""}`}</button>
        </div>
      </div>
    </div>
  );
}
