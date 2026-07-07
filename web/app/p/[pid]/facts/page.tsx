"use client";
import { use, useEffect, useState } from "react";
import { api, type Fact } from "@/lib/api";

const KINDS: { key: string; label: string; blurb: string }[] = [
  { key: "observation", label: "Observations", blurb: "Discrete facts about the project" },
  { key: "measurement", label: "Measurements", blurb: "Metric readings (see the trend on each assertion)" },
  { key: "all", label: "All", blurb: "" },
];

export default function Facts({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("observation");

  useEffect(() => {
    setLoading(true);
    api.get<{ facts: Fact[] }>(`/projects/${pid}/facts?kind=${kind}`).then((d) => { setFacts(d.facts); setLoading(false); });
  }, [pid, kind]);

  const active = KINDS.find((k) => k.key === kind)!;

  return (
    <>
      <div className="topbar">
        <h1>Facts</h1>
        <span className="sub">Observed reality — every fact carries provenance</span>
        <div className="flex" style={{ marginLeft: "auto" }}>
          {KINDS.map((k) => (
            <button key={k.key} className={`btn ${kind === k.key ? "primary" : "ghost"}`} onClick={() => setKind(k.key)}>{k.label}</button>
          ))}
        </div>
      </div>
      <div className="content">
        {active.blurb && <div className="mutedtext" style={{ fontSize: 13, marginBottom: 4 }}>{active.blurb}</div>}
        {loading ? <div className="empty">Loading…</div> : facts.length === 0 ? (
          <div className="card"><div className="empty">{kind === "observation" ? "No observations recorded yet. Measurements live under their assertions." : "None yet."}</div></div>
        ) : (
          <div className="card">
            {facts.map((f) => (
              <div key={f.id} className="row">
                <div className="between">
                  <div className="flex" style={{ minWidth: 0 }}>
                    {f.metricKey && f.measuredValue != null && (
                      <span className="mono" style={{ fontWeight: 700 }}>{f.measuredValue}</span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.statement}</span>
                  </div>
                  <span className="mutedtext" style={{ fontSize: 12, flexShrink: 0 }}>{new Date(f.observedAt).toLocaleString()}</span>
                </div>
                <div className="flex" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  {f.metricKey && <span className="evidence pill" style={{ color: "var(--violet)" }}>{f.metricKey}</span>}
                  {f.evidence.map((e, i) => (
                    <span key={i} className="evidence pill">{e.type}: {e.ref}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
