"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type TaskDetail } from "@/lib/api";

export default function TaskPage({ params }: { params: Promise<{ pid: string; tid: string }> }) {
  const { pid, tid } = use(params);
  const [d, setD] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<TaskDetail>(`/tasks/${tid}`).then((detail) => { setD(detail); setLoading(false); }).catch(() => setLoading(false));
  }, [pid, tid]);

  if (loading) return <div className="content"><div className="empty">Loading…</div></div>;
  if (!d) return <div className="content"><div className="empty">Task not found.</div></div>;

  return (
    <>
      <div className="topbar">
        <Link href={`/p/${pid}/tasks`} className="mutedtext" style={{ fontSize: 13 }}>← Tasks</Link>
        <h1 style={{ marginLeft: 8 }}>{d.task.title}</h1>
        <span className="pill" style={{ textTransform: "capitalize" }}>{d.task.status.replace("_", " ")}</span>
      </div>
      <div className="content">
        <div className="section-label" style={{ marginTop: 0 }}>Linked intent</div>
        <div className="card">
          {d.assertions.length === 0 ? <div className="empty" style={{ padding: 24 }}>No linked assertions.</div> :
            d.assertions.map((a) => (
              <Link key={a.id} href={`/p/${pid}/a/${a.humanId}`} className="row between" style={{ display: "flex" }}>
                <div className="flex" style={{ minWidth: 0 }}><span className="aid">{a.humanId}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span></div>
                <span className="mutedtext">→</span>
              </Link>
            ))}
        </div>

        <div className="section-label">Checkpoints — resumable progress</div>
        <div className="card">
          {d.checkpoints.length === 0 ? <div className="empty" style={{ padding: 24 }}>No checkpoints yet.</div> :
            d.checkpoints.map((cp) => (
              <div key={cp.id} className="row between"><span>{cp.note}</span><span className="mutedtext" style={{ fontSize: 12 }}>{new Date(cp.at).toLocaleString()}</span></div>
            ))}
        </div>
      </div>
    </>
  );
}
