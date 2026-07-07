"use client";
import { use, useEffect, useState } from "react";
import { api, type Fact } from "@/lib/api";

export default function Facts({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ facts: Fact[] }>(`/projects/${pid}/facts`).then((d) => { setFacts(d.facts); setLoading(false); });
  }, [pid]);
  return (
    <>
      <div className="topbar"><h1>Facts</h1><span className="sub">Observed reality — every fact carries provenance</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : facts.length === 0 ? (
          <div className="card"><div className="empty">No facts recorded yet.</div></div>
        ) : (
          <div className="card">
            {facts.map((f) => (
              <div key={f.id} className="row">
                <div className="between">
                  <span>{f.statement}</span>
                  <span className="mutedtext" style={{ fontSize: 12 }}>{new Date(f.observedAt).toLocaleString()}</span>
                </div>
                <div className="flex" style={{ marginTop: 6, flexWrap: "wrap" }}>
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
