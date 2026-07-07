"use client";
import { use, useEffect, useState } from "react";
import { api, type Milestone } from "@/lib/api";

export default function Roadmap({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<{ milestones: Milestone[] }>(`/projects/${pid}/milestones`).then((d) => { setMilestones(d.milestones); setLoading(false); });
  }, [pid]);
  return (
    <>
      <div className="topbar"><h1>Roadmap</h1><span className="sub">Progress computed from verified facts — not hand-set</span></div>
      <div className="content">
        {loading ? <div className="empty">Loading…</div> : milestones.length === 0 ? (
          <div className="card"><div className="empty">No milestones yet.</div></div>
        ) : milestones.map((m) => {
          const pct = m.progress.total === 0 ? 0 : Math.round((m.progress.verified / m.progress.total) * 100);
          return (
            <div key={m.id} className="card"><div className="row">
              <div className="between" style={{ marginBottom: 10 }}>
                <strong>{m.title}</strong>
                <span className="mutedtext" style={{ fontSize: 13 }}>
                  {m.progress.verified}/{m.progress.total} verified{m.targetDate ? ` · due ${m.targetDate}` : ""}
                </span>
              </div>
              <div className="progress"><span style={{ width: `${pct}%` }} /></div>
            </div></div>
          );
        })}
      </div>
    </>
  );
}
