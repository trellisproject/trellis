"use client";
import { use, useEffect, useState } from "react";
import { api, type Decision } from "@/lib/api";

export default function History({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ decisions: Decision[] }>(`/projects/${pid}/decisions`).then((d) => { setDecisions(d.decisions); setLoading(false); });
  }, [pid]);
  return (
    <>
      <div className="topbar"><h1>History</h1><span className="sub">The decision trail — why the project is the way it is</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : decisions.length === 0 ? (
          <div className="card"><div className="empty">No decisions recorded yet.</div></div>
        ) : (
          <div className="card">
            {decisions.map((d) => (
              <div key={d.id} className="row">
                <div className="flex"><span className="pill">{d.onType}</span><strong style={{ textTransform: "capitalize" }}>{d.choice}</strong>
                  <span className="mutedtext" style={{ marginLeft: "auto", fontSize: 12 }}>{new Date(d.at).toLocaleString()}</span></div>
                <div style={{ marginTop: 6 }}>{d.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
