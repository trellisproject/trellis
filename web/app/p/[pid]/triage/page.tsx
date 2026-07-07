"use client";
import { use, useEffect, useState } from "react";
import { api, type Drift, type Challenge, type Assertion } from "@/lib/api";

type ResolveTarget = { kind: "drift" | "challenge"; id: string; summary: string };

export default function Triage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [drifts, setDrifts] = useState<Drift[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [byId, setById] = useState<Record<string, Assertion>>({});
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ResolveTarget | null>(null);

  async function load() {
    const [tri, specs] = await Promise.all([
      api.get<{ drifts: Drift[]; challenges: Challenge[] }>(`/projects/${pid}/queue/triage`),
      api.get<{ specs: { slug: string }[] }>(`/projects/${pid}/specs`),
    ]);
    setDrifts(tri.drifts);
    setChallenges(tri.challenges);
    const map: Record<string, Assertion> = {};
    for (const s of specs.specs) {
      const d = await api.get<{ assertions: Assertion[] }>(`/projects/${pid}/specs/${s.slug}`);
      for (const a of d.assertions) map[a.id] = a;
    }
    setById(map);
    setLoading(false);
  }
  useEffect(() => { load(); }, [pid]);

  return (
    <>
      <div className="topbar">
        <h1>Triage</h1>
        <span className="sub">Open drifts and challenges — the gap between intent and reality</span>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : drifts.length + challenges.length === 0 ? (
          <div className="card"><div className="empty">Nothing to triage. Intent and reality agree. ✓</div></div>
        ) : (
          <>
            {drifts.map((d) => {
              const a = byId[d.assertionId];
              return (
                <div key={d.id} className="card">
                  <div className="row between">
                    <div className="stack">
                      <div className="flex">
                        <span className="pill">{d.kind} drift</span>
                        {a && <span className="assertion-id">{a.humanId}</span>}
                        {a && <span>{a.title}</span>}
                      </div>
                      <div className="mutedtext" style={{ fontSize: 13 }}>{d.summary}</div>
                    </div>
                    <button className="btn primary" onClick={() => setTarget({ kind: "drift", id: d.id, summary: d.summary })}>Resolve</button>
                  </div>
                </div>
              );
            })}
            {challenges.map((c) => (
              <div key={c.id} className="card">
                <div className="row between">
                  <div className="stack">
                    <div className="flex"><span className="pill">challenge</span><span>on a decision</span></div>
                    <div className="mutedtext" style={{ fontSize: 13 }}>{c.rationale}</div>
                  </div>
                  <button className="btn primary" onClick={() => setTarget({ kind: "challenge", id: c.id, summary: c.rationale })}>Resolve</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {target && <ResolveModal pid={pid} target={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); setLoading(true); load(); }} />}
    </>
  );
}

function ResolveModal({ pid, target, onClose, onDone }: { pid: string; target: ResolveTarget; onClose: () => void; onDone: () => void }) {
  const driftChoices = ["fix", "amend", "accept"];
  const challengeChoices = ["uphold", "supersede"];
  const choices = target.kind === "drift" ? driftChoices : challengeChoices;
  const [choice, setChoice] = useState(choices[0]!);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      const path = target.kind === "drift" ? `/projects/${pid}/drifts/${target.id}/resolve` : `/projects/${pid}/challenges/${target.id}/resolve`;
      await api.post(path, { choice, rationale });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Resolve {target.kind}</h3>
        <p className="mutedtext" style={{ fontSize: 13, marginTop: 0 }}>{target.summary}</p>
        <label>Resolution</label>
        <div className="flex">
          {choices.map((ch) => (
            <button key={ch} className={`btn ${choice === ch ? "primary" : ""}`} onClick={() => setChoice(ch)}>{ch}</button>
          ))}
        </div>
        <label>Rationale (required — the decision record)</label>
        <textarea className="input" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this resolution?" />
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <div className="between" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !rationale.trim()}>{busy ? "Recording…" : "Record decision"}</button>
        </div>
      </div>
    </div>
  );
}
