"use client";
import { useEffect, useState } from "react";
import { api, type Assertion } from "@/lib/api";
import { Badge } from "./Badge";

// Link existing assertions to a request (derived_from). New assertion text is
// authored in the spec file (git owns statements) — here you attach intent
// that already exists in a spec.
export function LinkAssertionsModal({ pid, requestId, onClose, onDone }: { pid: string; requestId: string; onClose: () => void; onDone: () => void }) {
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [alreadyLinked, setAlreadyLinked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [specs, req] = await Promise.all([
        api.get<{ specs: { slug: string }[] }>(`/projects/${pid}/specs`),
        api.get<{ request: { derived: { humanId: string }[] } }>(`/projects/${pid}/requests/${requestId}`),
      ]);
      const all: Assertion[] = [];
      for (const s of specs.specs) {
        const d = await api.get<{ assertions: Assertion[] }>(`/projects/${pid}/specs/${s.slug}`);
        all.push(...d.assertions.filter((a) => a.status !== "retired"));
      }
      setAssertions(all);
      setAlreadyLinked(new Set(req.request.derived.map((d) => d.humanId)));
      setLoading(false);
    })().catch((e) => { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); });
  }, [pid, requestId]);

  function toggle(h: string) {
    const n = new Set(selected);
    n.has(h) ? n.delete(h) : n.add(h);
    setSelected(n);
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      await api.post(`/projects/${pid}/requests/${requestId}/assertions`, { assertions: [...selected] });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  const available = assertions.filter((a) => !alreadyLinked.has(a.humanId));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>Link assertions to this request</h3>
        <p className="mutedtext" style={{ fontSize: 13, marginTop: 4 }}>
          Attach intent that already exists in a spec. To add new intent, author it in the spec file (marked derived from this request) and ingest — then link it here.
        </p>
        {loading ? (
          <div className="empty">Loading assertions…</div>
        ) : available.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            No unlinked assertions in any spec yet. Author them in the spec file and ingest first.
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            {available.map((a) => (
              <label key={a.humanId} className="row between" style={{ display: "flex", cursor: "pointer" }}>
                <div className="flex" style={{ minWidth: 0 }}>
                  <input type="checkbox" checked={selected.has(a.humanId)} onChange={() => toggle(a.humanId)} />
                  <span className="aid">{a.humanId}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                </div>
                <Badge status={a.status} />
              </label>
            ))}
          </div>
        )}
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <div className="between" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || selected.size === 0}>{busy ? "Linking…" : `Link ${selected.size || ""}`}</button>
        </div>
      </div>
    </div>
  );
}
